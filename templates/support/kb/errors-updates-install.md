# Update and install errors
keywords: update failed, update error, can't update, could not reach the update server, offline, automatic updates are off, not an installed copy, restart now, update installs when you close, reinstall, missing its own file, node.js not found, git not found, system check, install command
platforms: both

## Could not reach the update server
> Could not reach the update server (offline?).

Fix: check the internet connection (and that a VPN, firewall or antivirus isn't blocking the app), then press **Check now** in **Settings > General > Updates**.

## Automatic updates are off
> Automatic updates are off: not an installed copy.

What it means: this copy was started from a folder or download, not from the installed app, so it can't update itself.

Fix: On Windows: run the Videoxx installer and open the app from the Start menu. On Mac: drag Videoxx into Applications and open it from there.

## Something is still running
> Claude is still working. The update installs when you close the app, or restart once it is done.
> An export is still running. ...
> A routine is still running. ...

Fix: let it finish, then click **Restart now** in **Settings > General > Updates** (or just close the app: the update installs then). On Mac, click **Download**, open the file and drag the app into Applications (replace the old one).

## The app is missing its own file
> ... Videoxx is missing its own file ...

Fix: On Windows: run the installer again (projects and settings are kept); if it happens again, allow the Videoxx folder in your antivirus. On Mac: download Videoxx again and drag it into Applications.

## A tool is missing in System check
> Not found: edits cannot be reverted
> Not found: Claude cannot render edited intros
> Not found: audio pipeline disabled

What it means: Git, Node.js or Python is not installed (rows in **Settings > System > System check**).

Fix:
1. Click the button next to the row to copy its install command.
2. On Windows, run it in PowerShell: Git `winget install --id Git.Git -e`, Node.js `winget install --id OpenJS.NodeJS.LTS -e`, Python `winget install --id Python.Python.3.12 -e`. On Mac, in Terminal: Git `xcode-select --install`, Node.js `brew install node`, Python `brew install python` (Homebrew from brew.sh first).
3. Restart the app and press **Run checks**.
