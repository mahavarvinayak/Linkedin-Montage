# LinkedIn app setup

Cadence publishes as a **member** through LinkedIn's official versioned Posts
API. It needs an OAuth app, two LinkedIn products, a redirect URL and three
scopes. No partner program, scraping or browser automation is involved.

> LinkedIn's developer portal changes labels from time to time. If a menu name
> below has moved, use the equivalent item and keep the scopes and redirect URL
> exactly as shown.

---

## 1. Create the app

1. Open <https://www.linkedin.com/developers/apps> and choose **Create app**.
2. Use the LinkedIn Page you own when asked to associate a page. Member posting
   does not post to the page, but LinkedIn requires the association for app
   verification.
3. Upload a logo and complete the app details.
4. In **Settings → App visibility**, keep the app in development while testing.

## 2. Request the products

Open **Products** and request:

| Product | Scopes it grants | Why |
| --- | --- | --- |
| **Share on LinkedIn** | `w_member_social` | Create posts and upload images as the member |
| **Sign In with LinkedIn using OpenID Connect** | `openid`, `profile` | Read the member ID, name and picture |

Both are usually approved instantly for development apps. Wait until the
product status is **Added** before connecting.

You do **not** need:
- `r_member_social` (restricted; used for reading member posts)
- Marketing/Community Management APIs
- `w_organization_social`

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
LINKEDIN_SCOPES=openid profile w_member_social
LINKEDIN_VERSION=202610
```

Restart the dev server after changing environment values.

`LINKEDIN_VERSION` is the `LinkedIn-Version` header. LinkedIn supports a version
for at least one year after release, so bump it deliberately after reading the
[versioning changelog](https://learn.microsoft.com/en-us/linkedin/marketing/versioning).
The code default is `202610`.

## 5. Connect the profile

1. Sign in to Cadence.
2. Open **Settings → LinkedIn**.
3. Choose **Connect LinkedIn**.
4. Approve `openid`, `profile` and `w_member_social`.
5. LinkedIn returns to `/api/linkedin/callback`. Cadence:
   - verifies the OAuth `state` cookie,
   - exchanges the code for tokens,
   - reads `/v2/userinfo`,
   - stores tokens in Supabase Vault through a service-role-only RPC,
   - saves the member ID, name, picture, scopes and expiry in `settings`.
6. The Settings page should show the member name, `urn:li:person:…`, scopes and
   token expiry.

Tokens are never returned to the browser. If the storage RPC or settings update
fails, the callback reports the error and does not mark the profile connected.

## 6. Test

- **Test connection** calls `/v2/userinfo` with the stored token. It refreshes
  the token first if it is within two minutes of expiry.
- It warns if `w_member_social` is missing from the stored scope list.
- Send a test Telegram message from the same page.

Then create a text-only post, schedule it a few minutes ahead, and confirm:
- the post appears in **Content Queue**,
- the worker logs `publish_started` then `published`,
- the permalink opens the live LinkedIn post,
- the Telegram success message arrives.

Start with a text-only post. Add images only after the basic flow works.

## Token lifetime and refresh

- Access tokens commonly last **60 days** (`expires_in` is stored with the
  token).
- LinkedIn issues refresh tokens only when the app's products/program support
  them. When one is present, the worker refreshes automatically before expiry
  and stores the new token.
- Without a refresh token, reconnect from Settings before the access token
  expires. The Settings page warns when expiry is within 7 days.
- `invalid_grant` / HTTP 401 means reconnect. Retrying a post will not fix it.

## How a post is created

1. `POST /rest/images?action=initializeUpload` with `owner: urn:li:person:{sub}`.
2. `PUT` the binary to the returned upload URL.
3. `POST /rest/posts` with:
   - `author` = the member URN
   - `commentary` = caption + blank line + hashtags
   - `visibility: PUBLIC`
   - `distribution.feedDistribution: MAIN_FEED`
   - `lifecycleState: PUBLISHED`
   - `content.media.id` for one image, `content.multiImage.images` for several
4. The post URN comes from the `x-restli-id` response header; the permalink is
   `https://www.linkedin.com/feed/update/{urn}/`.

The image URN is usable immediately. LinkedIn processes images asynchronously,
which is why image failures can appear after the API accepts the request.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `redirect_uri does not match` | URL differs from the LinkedIn Auth tab, including port, trailing slash or scheme | Copy the exact value from Settings → App configuration into the Auth tab |
| `invalid_client` | Wrong client ID/secret, or secret was regenerated | Update the server environment and Edge Function secrets |
| `invalid_scope` | Products not approved or scope typo | Confirm both products are **Added**; use `openid profile w_member_social` |
| Callback: “state check failed” | Cookie blocked, expired after 10 minutes, or a different browser | Start again from Settings in the same browser |
| Connected, but Test says 401 | Token expired/revoked, or the app secret changed | Reconnect from Settings |
| Publishing fails with 403 | `w_member_social` missing, product not approved, or posting restricted | Reconnect, confirm the scope list, check the app's product status |
| 429 rate limit | Too many requests | The worker retries with `Retry-After` or exponential backoff |
| Image upload fails | Unsupported/corrupt file, object missing, or LinkedIn processing error | Use JPG/PNG/GIF under 8 MB; inspect the error in Failed Posts |
| Post succeeded on LinkedIn but Cadence says uncertain | Network timeout or 5xx after creation | Open LinkedIn, verify the post, then either mark it published manually or confirm a retry |
| Token expiry warning | Access token near 60 days | Reconnect; keep refresh enabled if your app receives refresh tokens |

If a post is `manual_required`, **do not retry blindly**. Check the profile
first. The retry dialog requires an explicit “I checked LinkedIn” confirmation.

## Official references

- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [OAuth 2.0](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [Versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning)
- [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
