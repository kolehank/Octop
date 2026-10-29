agentbuddy green portable package
============================

Extract this zip anywhere. It includes a portable CPython runtime and agentbuddy
dependencies. No system Python install is required.

Start
-----
  macOS / Linux:  ./start.sh
  Windows:        start.bat

Listen address and port come from data/config.json (default
http://127.0.0.1:8088). Data dir = ./data (AGENTBUDDY_HOME).

  ./start.sh --home /path/to/data
  ./start.sh --host 0.0.0.0 --port 8088

--host and --port are saved back to config.json. Omit them to keep the file.

First launch follows the normal agentbuddy setup wizard (create admin password).

Layout
------
  runtime/     portable CPython
  packages/    agentbuddy + locked dependencies (site-packages)
  launch.py    entry bootstrap (loads packages/ + Windows pywin32 DLLs)
  start.sh / start.bat
  README.txt
  VERSION.txt

Notes
-----
  Do not set PYTHONPATH=packages. Always start via start.sh / start.bat /
  launch.py so .pth files (pywin32) are processed.

  Linux: "Permission denied" on ./start.sh usually means the extract step
  (or a Windows detour of the zip) dropped the executable bit — restore it:

    chmod +x start.sh launch.py && chmod -R u+x runtime/bin/

  If the bits are already set (rwxr-xr-x) but it still fails, the target
  filesystem is mounted noexec — extract somewhere else (e.g. your home dir).

  macOS: if Gatekeeper quarantines the unzipped folder:

    xattr -dr com.apple.quarantine .

Windows: if import pywintypes fails, rebuild from a current
  green package (launch.py + pywin32 DLL copy). Do not set PYTHONPATH manually.
