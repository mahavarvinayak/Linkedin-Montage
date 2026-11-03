# LinkedIn app setup

Cadence publishes as a **member** for personal profiles and as an
**organization** for Company Pages and Showcase Pages. Both paths use LinkedIn's
official versioned REST APIs: `/rest/posts` and `/rest/images`. No scraping or
browser automation is involved.

Member publishing works with self-serve products. Organization publishing is
**optional** and needs LinkedIn's Community Management API approval — being a
page administrator is not enough on its own.

> LinkedIn's developer portal changes labels from time to time. If a menu name
> below has moved, use the equivalent item and keep the scopes and redirect URL
> exactly as shown.

---

## 1. Create the app

1. Open <https://www.linkedin.com/developers/apps> and choose **Create app**.
2. Use the LinkedIn Page you own when asked to associate a page. LinkedIn
   requires the association for app verification; it does not restrict which
   pages you can later publish to.
3. Upload a logo and complete the app details.
4. In **Settings → App visibility**, keep the app in development while testing.

## 2. Request the products

Open **Products** and request:

| Product | Scopes it grants | Why |
| --- | --- | --- |
| **Share on LinkedIn** | `w_member_social` | Create posts and upload images as the member |
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile` | Read the member ID, name and picture |
| **Community Management API** (optional) | `r_organization_admin`, `w_organization_social` | List the organizations the member administers and publish as them |

The first two are usually approved instantly for development apps. Wait until
each product shows **Added** before connecting.

**Community Management API** is a separate, reviewed product. Request it only if
you need Company or Showcase Page publishing, and expect an approval step. Until
it is approved, Cadence still works for personal profiles.

Do **not** request `r_member_social`; Cadence never reads member posts.

### What each scope does in Cadence

| Scope | Used for |
| --- | --- |
| `openid`, `profile` | `GET /v2/userinfo` after the OAuth callback |
| `w_member_social` | Personal profile publishing and image upload |
| `r_organization_admin` | `GET /rest/organizationAcls` organization discovery |
| `w_organization_social` | Organization publishing and organization-owned images |

If a scope is missing, Cadence keeps working with what it has and marks the
affected destination **Missing permission** with an explanation. It never
pretends a destination is publishable.

## 3. Add the redirect URL

Open **Auth**:

- **Authorized redirect URLs** — add every deployment, exactly:

  ```
  http://localhost:3000/api/linkedin/callback
  https://your-production-domain.com/api/linkedin/callback
  ```

  Rules:
  - The scheme, host, port and path must match `LINKEDIN_REDIRECT_URI` exactly.
  - No trailing slash.
  - `http` is only for localhost; production must use `https`.
  - If you use a custom domain, add both the Vercel preview URL and the custom
    domain, or keep one stable production URL.

- **Client ID** and **Primary Client Secret** — copy these into the server
  environment.

## 4. Configure Cadence

In `.env.local` (and in your hosting provider):

```bash
LINKEDIN_CLIENT_ID=your-client-id
LINKEDIN_CLIENT_SECRET=your-primary-client-secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/linkedin/callback
# Member-only:
LINKEDIN_SCOPES=openid profile w_member_social
# With approved Community Management API access:
# LINKEDIN_SCOPES=openid profile w_member_social r_organization_admin w_organization_social
LINKEDIN_VERSION=202610
```

Restart the dev server after changing environment values. The Edge Functions
read the same client credentials from Supabase secrets (`npx supabase secrets
set LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=...`), not from the Next.js
environment.

`LINKEDIN_VERSION` is the `LinkedIn-Version` header. LinkedIn supports a version
for at least one year after release, so bump it deliberately after reading the
[versioning changelog](https://learn.microsoft.com/en-us/linkedin/marketing/versioning).
The code default is `202610`.

After adding organization scopes, **reconnect every profile**. An existing token
keeps its original scopes; only a new OAuth grant picks up the new ones.

## 5. Connect profiles

Cadence supports multiple connected LinkedIn profiles. Each one has its own
token, and each destination publishes through the profile that owns it.

1. Sign in to Cadence.
2. Open **Settings → LinkedIn**.
3. Choose **Connect LinkedIn** and approve the scopes you configured.
4. Repeat for every profile you want to publish as.
5. LinkedIn returns to `/api/linkedin/callback`. Cadence:
   - verifies the OAuth `state` cookie,
   - exchanges the code for tokens,
   - reads `/v2/userinfo`,
   - stores the token in Supabase Vault under `linkedin_token_<member_urn>`
     through a service-role-only RPC,
   - adds a `linkedin_accounts` row and makes this profile the primary profile
     shown in Settings,
   - best-effort syncs destinations for that profile.
6. The Settings page should show each account with its name, `urn:li:person:…`,
   scopes and token expiry.

Tokens are never returned to the browser, are never stored in PostgREST tables,
and one account can never read another account's token. If the storage RPC or
settings update fails, the callback reports the error and does not mark that
profile connected.

## 6. Sync destinations

1. Open **Destinations**.
2. Choose **Refresh destinations**.
3. Cadence queries LinkedIn once per connected profile:
   - `GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`
     (paginated, up to 20 pages of 100) for organizations,
   - `GET /rest/organizations/{id}` for each name and type,
   - the profile itself from the OAuth `userinfo` response.
4. Rows are upserted into `linkedin_destinations`. Nothing about names, IDs,
   counts or types is hardcoded; a page that appears on LinkedIn appears in
   Cadence after a refresh.
5. Destinations that LinkedIn no longer reports, or that were disabled in
   Cadence, are handled explicitly:
   - a destination that lost access is marked **Unavailable**, never deleted, so
     historical jobs keep their name;
   - a destination you disabled stays disabled across syncs, and disabling it
     cancels the jobs that were already queued for it (published jobs are never
     touched).
6. You can also add an organization URN manually. Cadence verifies it with
   `GET /rest/organizations/{id}` and stores it as **Unverified**; publishing
   still has to succeed with a real token.

Only destinations that are enabled, authorized and `available`/`unverified` can
be selected in the composer.

## 7. Test

- **Test connection** calls `/v2/userinfo` with the stored token. It refreshes
  the token first if it is within two minutes of expiry.
- It warns if `w_member_social` is missing from the stored scope list.
- Send a test Telegram message from the same page.

Then create a text-only post, select one personal profile, schedule it a few
minutes ahead, and confirm:
- the post appears in **Content Queue** with a per-destination status,
- the worker logs `publish_started` then `published`,
- the permalink opens the live LinkedIn post,
- the Telegram success message names the destination.

Only after that works, add an organization destination and repeat the test.

## Token lifetime and refresh

- Access tokens commonly last **60 days** (`expires_in` is stored with the
  token).
- LinkedIn issues refresh tokens only when the app's products/program support
  them. When one is present, the worker refreshes automatically before expiry
  and stores the new token for that account only.
- Without a refresh token, reconnect that profile from Settings before the
  access token expires. The Settings page warns when expiry is within 7 days.
- `invalid_grant` / HTTP 401 means reconnect that profile. Retrying a post will
  not fix it, and Cadence will not fall back to another profile's token.

## How a post is created

One job per (post, destination), each with its own author and token:

1. `POST /rest/images?action=initializeUpload` with
   `owner: urn:li:person:{sub}` for a personal profile, or
   `owner: urn:li:organization:{id}` for a page.
2. `PUT` the binary to the returned upload URL.
3. `POST /rest/posts` with:
   - `author` = the destination's author URN
   - `commentary` = caption + blank line + hashtags
   - `visibility: PUBLIC`
   - `distribution.feedDistribution: MAIN_FEED`
   - `lifecycleState: PUBLISHED`
   - `content.media.id` for one image, `content.multiImage.images` for several
4. The post URN comes from the `x-restli-id` response header; the permalink is
   `https://www.linkedin.com/feed/update/{urn}/` and is stored on that job.

Each destination uploads its own images because image ownership follows the
author. A failure on one destination never blocks the others.

The image URN is usable immediately. LinkedIn processes images asynchronously,
which is why image failures can appear after the API accepts the request.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `redirect_uri does not match` | URL differs from the LinkedIn Auth tab, including port, trailing slash or scheme | Copy the exact value from Settings → App configuration into the Auth tab |
| `invalid_client` | Wrong client ID/secret, or secret was regenerated | Update the server environment and Edge Function secrets |
| `invalid_scope` | Products not approved or scope typo | Confirm every product is **Added**; use `openid profile w_member_social` (plus organization scopes only after approval) |
| Callback: “state check failed” | Cookie blocked, expired after 10 minutes, or a different browser | Start again from Settings in the same browser |
| Connected, but Test says 401 | Token expired/revoked, or the app secret changed | Reconnect that profile from Settings |
| Destinations refresh says organization discovery is paused | Token is missing `r_organization_admin` and `w_organization_social` | Request the Community Management API, add the scopes, redeploy, reconnect, refresh |
| Organization discovery returns 403 | App not approved for Community Management API, or the member is not an organization administrator | Confirm product approval **and** the member's admin role on the page |
| Destination shows **Missing permission** | Organization was discovered but `w_organization_social` is absent from the token | Reconnect after LinkedIn approves the scope; do not publish to it yet |
| Publishing fails with 403 on a personal profile | `w_member_social` missing or product not approved | Reconnect, confirm the scope list, check the app's product status |
| Publishing fails with 403 on an organization | Not an approved page admin, organization product not granted, or the token was issued before the scope was added | Verify the admin role, then reconnect that profile so a fresh token includes `w_organization_social` |
| Destination marked unavailable after a sync | LinkedIn stopped returning it, or the account was disconnected | Reconnect the owning profile and refresh destinations; history is preserved |
| 429 rate limit | Too many requests | The worker retries with `Retry-After` or exponential backoff |
| Image upload fails | Unsupported/corrupt file, object missing, or LinkedIn processing error | Use JPG/PNG/GIF under 8 MB; inspect the error in Failed Posts |
| Post succeeded on LinkedIn but Cadence says uncertain | Network timeout or 5xx after creation | Open LinkedIn, verify that destination, then mark it published manually or confirm a retry |
| Token expiry warning | Access token near 60 days | Reconnect that profile; keep refresh enabled if your app receives refresh tokens |

If a destination is `manual_required`, **do not retry blindly**. Check the
profile first. The per-destination retry dialog requires an explicit “I checked
LinkedIn” confirmation, and retrying one destination never touches the others.

## Official references

- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [Organization Access Control](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control)
- [Organizations API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api)
- [OAuth 2.0](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [Versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning)
- [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
