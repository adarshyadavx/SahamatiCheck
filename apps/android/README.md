# SahamatiCheck for Android

A small Android app (Android 8.0+, about 20 KB) that shows the SahamatiCheck website and adds one native feature:
it appears in Android's **Share** menu. In the Play Store, open any app, tap **⋮ → Share → SahamatiCheck**, and the
check starts by itself. Like the website and the extension, it only displays reports; all analysis happens on the
SahamatiCheck server (CLAUDE.md rule 5). It asks for one permission, internet access.

## Use it

1. Install `sahamaticheck.apk` (from the website's **Download** page, `/en/download`, or build it below).
2. On first launch, enter the address of a SahamatiCheck website the phone can reach.
3. Share a Play Store app into SahamatiCheck, or browse the site normally. Links to privacy policies and to Google
   Play open in your browser. The menu (⋮) has **Reload**, **Server address** and **Open in browser**.

### Running the website for your phone

The phone needs one address that serves both the website and the API. Start the website with the API passed
through it (`NEXT_PUBLIC_API_BASE=same-origin`) and listening on your network:

```bash
cd backend && .venv/bin/uvicorn sahamati_api.main:app --port 8000          # API, local only
cd apps/web && NEXT_PUBLIC_API_BASE=same-origin npx next dev -H 0.0.0.0 -p 3100
```

Then enter `http://<your computer's Wi-Fi IP>:3100` in the app (both devices on the same Wi-Fi; your firewall
may ask to allow it). For a hosted site, enter its `https://` address.

## Build it

No Gradle, no downloads: `build.sh` drives the Android SDK tools directly (aapt2 → javac → d8 → zipalign →
apksigner).

```bash
apps/android/build.sh            # -> apps/android/build/sahamaticheck.apk
```

Needs a JDK 11+ (`JAVA_HOME`, or a JDK under `%LOCALAPPDATA%\Programs` on Windows) and an Android SDK with
build-tools and a platform (`ANDROID_HOME`, or `%LOCALAPPDATA%\Android\Sdk`). Runs in Git Bash on Windows.

By default the APK is signed with the standard debug key, which is fine for testing and sideloading. For an APK
you hand out widely, sign with your own key and keep it safe, since every update must be signed with the same key:

```bash
SIGN_KEYSTORE=release.jks SIGN_ALIAS=sahamati SIGN_STOREPASS=... apps/android/build.sh
```

To publish a new build on the website: `cp apps/android/build/sahamaticheck.apk apps/web/public/downloads/`.

## Layout

```
AndroidManifest.xml                 one activity; launcher + "text/plain" Share target
src/com/sahamaticheck/app/MainActivity.java
res/values{,-hi}/strings.xml        English and Hindi
res/values/styles.xml               Mudra colours (neel #2a3a8f)
res/mipmap-anydpi-v26/, drawable/   adaptive icon (vector seal with a tick)
build.sh
```
