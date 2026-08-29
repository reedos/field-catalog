# Screenshots

Images referenced from the top-level README.

**Take these against a scratch library, never your own.** A screenshot of a real
catalog publishes filenames, species, place names, capture dates, and sometimes
coordinates in the detail panel. Create a throwaway library, import a few frames
you are happy to have public, and shoot those.

```bash
fieldcatalog --library /tmp/demo init
fieldcatalog --library /tmp/demo import --source /path/to/a/few/photos
FIELDCATALOG_LIBRARY=/tmp/demo npm run tauri -- dev
```
