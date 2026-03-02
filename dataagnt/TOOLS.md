# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

### Nodes

- **DESKTOP-RS8TLOL** (Windows PC)
  - IP: `192.168.88.7`
  - **Ưu tiên hàng đầu**: Sử dụng skill `RemotePCAPI` thay vì tool `nodes`.
  - Screenshot API: `http://192.168.88.7:3456/api/screenshot` (Trả về file PNG trực tiếp).


