# Bygg och installera på telefonen (trådlöst)

## Gör detta en gång (med USB-kabel)

1. Koppla in telefonen med USB.
2. På telefonen: **Inställningar → Utvecklaralternativ → USB-felsökning** = **På**.
3. Öppna PowerShell och kör:

```powershell
cd "c:\Users\gurra\Desktop\Naphab applikation\naphab-app\scripts"
.\setup-wireless-adb.ps1
```

4. Koppla ur USB när det står "Klart".

---

## Sedan varje gång du ska bygga

**Enklast:** Dubbelklicka på **`Bygg-och-installera.bat`** i mappen `naphab-app` (samma mapp som package.json). Bygger preview-APK och installerar på telefonen.

**Alternativ:** I terminalen från `naphab-app`:
```powershell
npm run deploy:android
```

Krav: telefon + dator på samma Wi‑Fi.

Scriptet provar nu i denna ordning:
1) redan ansluten enhet
2) senast sparad port
3) auto-upptackt port via `adb mdns services`
4) fragar efter port manuellt om inget annat fungerar

---

## Anslutningen fungerar inte?

- **Trådlös felsökning:** Slå av och sedan på igen (**Inställningar → Utvecklaralternativ → Trådlös felsökning**). Ibland ansluts enheten då.
- Om auto-upptackt misslyckas: kör `.\build-and-install.ps1 -Port XXXXX` där XXXXX är porten som står under "Anslut" på telefonen.
