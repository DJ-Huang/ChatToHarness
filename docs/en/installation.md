# Install ChatToHarness

[English](../en/installation.md) | [简体中文](../zh-CN/installation.md) | [日本語](../ja/installation.md)

> For ChatToHarness 0.6.0.

## Your goal

Install the official release for your computer and open the console.

## Before you start

Check the system and account requirements, then open GitHub Releases from the website.

## Steps

1. Mac: download the Apple silicon .dmg, open it and drag the app to Applications. Launch it there.
2. Windows: download the x64 -setup.exe and follow the installation wizard.
3. Check the file against SHA256SUMS.txt from the same release and read its signing notes.
4. Open the app and look for Overview, Connection and Work directories in the sidebar.

![Install ChatToHarness](../images/help/en/install.svg)

Workflow illustration showing the sequence, not an actual client execution result.

## What success looks like

The console opens. Installation alone does not establish a tunnel; connection details come next.

## If it does not work

The v0.6.0 Mac app is not notarized and the Windows installer is unsigned. Verify the source and checksum before using the operating system’s security controls. Do not disable system-wide protection or use an installer for a different architecture.

[GitHub Releases](https://github.com/DJ-Huang/ChatToHarness/releases)

## Next steps

- [Make your first connection](first-connection.md)
- [Fix installation or launch problems](installation-problems.md)
