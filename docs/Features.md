# Features

Shipped features, newest first. Phase rows collect under **In progress** while a feature is being built, and collapse into one **Shipped** row when it closes out.

## Shipped

| Date | Feature | What it does | Docs |
| ---- | ------- | ------------ | ---- |

## In progress

### meeting-file-upload

| Date       | Phase                                     | What landed                                                                                                                                                                                               | PR                                                                |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-08-16 | 1. Store a meeting file and serve it back | Meeting owners can upload a file to their own meeting, list a meeting's files, and download a file byte-for-byte.                                                                                         | [#115](https://github.com/seosmmbusiness/video-meetings/pull/115) |
| 2026-08-16 | 2. Enforce the upload limits              | Uploads are refused with a stated reason past 500 MB, an unaccepted type, 20 files per meeting, or 20 GB per owner — enforced at the API itself, nothing left behind on a refusal or a broken connection. | [#117](https://github.com/seosmmbusiness/video-meetings/pull/117) |
| 2026-08-16 | 3. Soft delete, restore and purge         | A file can be deleted, restored within 30 days, and is permanently purged with its bytes after — deleted files keep counting against the owner's storage until then.                                      | [#119](https://github.com/seosmmbusiness/video-meetings/pull/119) |
