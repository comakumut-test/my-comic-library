# Comic Shelf

A **private, password-protected comic library** you host yourself. Upload your comics once and read them in the browser on your phone, tablet or PC. The app runs free on Vercel, and your files live in your own Cloudflare R2 bucket.

## Features

- **Formats:** CBZ, CBR (RAR/RAR5), CB7, CBT, plain ZIP/RAR/7z/TAR, and PDF.
- **Reader:** single page, two-page spread or vertical scroll (webtoons); fit to screen or width; manga (right-to-left) mode; pinch-to-zoom on phones; keyboard shortcuts.
- **Fast opening:** comics are split into pages on upload, and upcoming pages load in the background while you read. Pages you've read are cached on the device (up to 1 GB).
- **Library:** folders, search, read/unread marks, "Continue where you left off", bulk select/move/delete, download as .cbz.
- **Readlists:** as many reading lists as you like; finished issues move to a "Finished" section; a "Next in list" button appears on the last page.
- **News:** each week's new releases grouped by publisher (Marvel, DC, Image…), series following, and a home-page alert when a followed series has a new issue. (Needs a free Metron account; optional.)
- **Privacy:** files stay in a private bucket, every request needs your session cookie, and the site asks search engines not to index it.

## Setup (about 20–30 minutes)

You need free accounts on **GitHub**, **Vercel** and **Cloudflare**. A **Metron** account is optional (for the News page and comic search).

### 1. Get your own copy of the code
Click **Fork** at the top right of this page, or download the code and upload it to a new repository in your account. Making your copy **Private** is recommended.

### 2. Create a Cloudflare R2 bucket
1. Go to dash.cloudflare.com → **R2 Object Storage** in the sidebar. (It may ask for a payment method the first time; the first 10 GB are free.)
2. **Create bucket** → name it `comics` → create.
3. On the R2 overview page, copy your **Account ID**.
4. Open **Manage R2 API Tokens** (or **API → Manage API tokens**) → **Create API token** → permission **Object Read & Write**, limited to the `comics` bucket → create. Copy the **Access Key ID** and **Secret Access Key** (the secret is shown only once).

### 3. Deploy to Vercel
1. vercel.com → **Add New… → Project** → pick your copy on GitHub.
2. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | Account ID from step 2 |
   | `R2_ACCESS_KEY_ID` | Access Key ID from step 2 |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key from step 2 |
   | `R2_BUCKET` | `comics` |
   | `METRON_USERNAME` | (optional) your Metron username |
   | `METRON_PASSWORD` | (optional) your Metron password |

3. Click **Deploy**. When it finishes, note your site address (e.g. `https://your-project.vercel.app`).

### 4. Allow your site in R2 (CORS)
The browser uploads to and reads from R2 directly, so this step is required.
Cloudflare → R2 → `comics` bucket → **Settings** → **CORS Policy** → **Add/Edit** → paste this, with your own address:

```json
[
  {
    "AllowedOrigins": ["https://your-project.vercel.app"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### 5. Set your password
Open your site. **The password you type on the first sign-in becomes the site's password.** Do this right after deploying, before you share the address with anyone.

That's it. Drag comics onto the page or use **Upload**.

## FAQ

**I forgot my password / want to change it.**
In Cloudflare → R2 → `comics` bucket, delete the file `app/auth.json`. The next password you sign in with becomes the new one.

**The News page says "Connect a comic database".**
Create a free account at metron.cloud, add `METRON_USERNAME` and `METRON_PASSWORD` in Vercel, then go to **Deployments → ⋯ → Redeploy**. The weekly list refreshes automatically every morning.

**What does it cost?**
Vercel Hobby is free. Cloudflare R2 includes 10 GB free, then about $0.015 per GB per month; downloads (reading) are free. A 50 GB collection costs roughly $0.60 a month.

**Can I use it like an app on my phone?**
Open the site in Chrome → ⋮ → **Add to Home screen**. It opens full-screen without the address bar.

**Can anyone else see my comics?**
No. Files stay in a private bucket and are only shown, through short-lived signed links, to someone signed in with your password.

## Running locally (for developers)

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

Next.js 16, React 19, TypeScript. Archives are opened in the browser (fflate, libarchive.js); the server only issues signed upload/read links.
