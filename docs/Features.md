# Features

Shipped features, newest first. Phase rows collect under **In progress** while a feature is being built, and collapse into one **Shipped** row when it closes out.

## Shipped

| Date       | Feature             | What it does                                                                                                                                     | Docs                                                          |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 2026-08-16 | meeting-file-upload | Meeting owners upload, play, preview, download, delete and restore files on their own meetings — up to 500 MB each, 20 per meeting, 20 GB total. | [PRD](archive/meeting-file-upload/meeting-file-upload-PRD.md) |

## In progress

### user-profile

| Date       | Phase                                         | What landed                                                                                                                                                                                                                        | PR                                                                |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-08-18 | 1. Account name in the API                    | An account can hold a display name, and the signed-in caller reads and changes their own — and only their own — over `GET`/`PATCH /profile`, behind the JWT guard.                                                                 | [#174](https://github.com/seosmmbusiness/video-meetings/pull/174) |
| 2026-08-20 | 2. Profile page and the name on the dashboard | A signed-in user has a `/profile` page showing their email and name, changes the name there, and the dashboard greets them by it instead of by their email address.                                                                | [#178](https://github.com/seosmmbusiness/video-meetings/pull/178) |
| 2026-08-21 | 3. Avatar upload and serving in the API       | An account holds one avatar image — its owner uploads, replaces, fetches and removes it over `/profile/avatar`, capped at 5 MB and limited to PNG, JPEG and WebP, and nobody else can fetch it.                                    | [#181](https://github.com/seosmmbusiness/video-meetings/pull/181) |
| 2026-08-21 | 4. Avatar in the profile and on the dashboard | A signed-in user uploads, replaces and removes their avatar on `/profile` and sees it beside their name there and on the dashboard — the bytes travel through a same-origin proxy, so the session token never reaches the browser. | [#183](https://github.com/seosmmbusiness/video-meetings/pull/183) |
| 2026-08-23 | 5. Password change and session revocation     | A signed-in user changes their password over `PATCH /profile/password` by proving the current one, and every other session of that account stops working the moment they do.                                                       | [#185](https://github.com/seosmmbusiness/video-meetings/pull/185) |
| 2026-08-23 | 6. Password change on the profile page        | A signed-in user changes their password on `/profile` by proving the current one — they stay signed in, a wrong current password is shown in place, and any other session of theirs lands on `/login` on its next move.            | [#187](https://github.com/seosmmbusiness/video-meetings/pull/187) |
