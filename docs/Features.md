# Features

Shipped features, newest first. Phase rows collect under **In progress** while a feature is being built, and collapse into one **Shipped** row when it closes out.

## Shipped

| Date | Feature | What it does | Docs |
| ---- | ------- | ------------ | ---- |

## In progress

### meeting-file-upload

| Date       | Phase                                      | What landed                                                                                                                                                                                               | PR                                                                |
| ---------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-08-16 | 1. Store a meeting file and serve it back  | Meeting owners can upload a file to their own meeting, list a meeting's files, and download a file byte-for-byte.                                                                                         | [#115](https://github.com/seosmmbusiness/video-meetings/pull/115) |
| 2026-08-16 | 2. Enforce the upload limits               | Uploads are refused with a stated reason past 500 MB, an unaccepted type, 20 files per meeting, or 20 GB per owner — enforced at the API itself, nothing left behind on a refusal or a broken connection. | [#117](https://github.com/seosmmbusiness/video-meetings/pull/117) |
| 2026-08-16 | 3. Soft delete, restore and purge          | A file can be deleted, restored within 30 days, and is permanently purged with its bytes after — deleted files keep counting against the owner's storage until then.                                      | [#119](https://github.com/seosmmbusiness/video-meetings/pull/119) |
| 2026-08-16 | 4. Meeting page with its file list         | Every meeting has its own page, linked from the dashboard, showing its details and files with a working download — the first part of the feature visible in a browser.                                    | [#121](https://github.com/seosmmbusiness/video-meetings/pull/121) |
| 2026-08-16 | 5. Upload files from the meeting page      | Owners can upload several files at once from the meeting page, each with its own progress, cancel and retry — the feature is now usable end to end.                                                       | [#123](https://github.com/seosmmbusiness/video-meetings/pull/123) |
| 2026-08-16 | 6. Play, preview and remove files in place | Video/audio play and images/PDFs render inside the page, and a file can be deleted into "Deleted files" and restored — nothing leaves the meeting page anymore.                                           | [#125](https://github.com/seosmmbusiness/video-meetings/pull/125) |
