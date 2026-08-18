# Features

Shipped features, newest first. Phase rows collect under **In progress** while a feature is being built, and collapse into one **Shipped** row when it closes out.

## Shipped

| Date       | Feature             | What it does                                                                                                                                     | Docs                                                          |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 2026-08-16 | meeting-file-upload | Meeting owners upload, play, preview, download, delete and restore files on their own meetings — up to 500 MB each, 20 per meeting, 20 GB total. | [PRD](archive/meeting-file-upload/meeting-file-upload-PRD.md) |

## In progress

### user-profile

| Date       | Phase                      | What landed                                                                                                                                                        | PR                                                                |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 2026-08-18 | 1. Account name in the API | An account can hold a display name, and the signed-in caller reads and changes their own — and only their own — over `GET`/`PATCH /profile`, behind the JWT guard. | [#174](https://github.com/seosmmbusiness/video-meetings/pull/174) |
