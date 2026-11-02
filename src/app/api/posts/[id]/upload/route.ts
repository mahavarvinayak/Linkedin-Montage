import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, getRawPost } from "@/lib/api";
import { isEditableStatus } from "@/lib/post-utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, MEDIA_BUCKET } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DetectedImage = { mime: (typeof ALLOWED_IMAGE_TYPES)[number]; ext: "jpg" | "png" | "gif" };

function detectImage(bytes: Uint8Array): DetectedImage | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => bytes[index] === byte)) {
    return { mime: "image/png", ext: "png" };
  }

  const header = String.fromCharCode(...bytes.slice(0, 6));
  if (header === "GIF87a" || header === "GIF89a") {
    return { mime: "image/gif", ext: "gif" };
  }

  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let post;
  try {
    post = await getRawPost(auth.supabase, id);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the post.", 500);
  }

  if (!post) return apiError("Post not found.", 404);
  if (!isEditableStatus(post.status)) {
    return apiError("Published or in-flight posts cannot receive new media.", 409);
  }

  if (post.media_paths.length >= MAX_IMAGES) {
    return apiError(`This post already has the maximum of ${MAX_IMAGES} images.`, 409);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Invalid upload.");
  }

  const entry = form.get("file");
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
    return apiError("Choose an image to upload.");
  }

  const file = entry as File;
  if (file.size === 0) return apiError("That file is empty.");
  if (file.size > MAX_IMAGE_BYTES) {
    return apiError(`Images must be smaller than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`, 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectImage(new Uint8Array(buffer));

  if (!detected) {
    return apiError("Only JPG, PNG or GIF images are supported.", 415);
  }

  if (file.type && file.type !== detected.mime) {
    return apiError("The file contents do not match its declared image type.", 415);
  }

  const path = `posts/${id}/${crypto.randomUUID()}.${detected.ext}`;

  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, buffer, {
      contentType: detected.mime,
      cacheControl: "3600",
      upsert: false,
    });

    if (error) return apiError(`Upload failed: ${error.message}`, 500);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Upload failed.", 500);
  }

  return NextResponse.json({
    path,
    mimeType: detected.mime,
    size: file.size,
  });
}
