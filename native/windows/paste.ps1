$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SCPaste {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[SCPaste]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[SCPaste]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[SCPaste]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
[SCPaste]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
[pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
