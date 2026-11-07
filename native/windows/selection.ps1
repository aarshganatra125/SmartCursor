$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SCKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$previous = ''
try { $previous = [System.Windows.Forms.Clipboard]::GetText() } catch {}
$sentinel = [guid]::NewGuid().ToString()
[System.Windows.Forms.Clipboard]::SetText($sentinel)
[SCKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[SCKeys]::keybd_event(0x43, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[SCKeys]::keybd_event(0x43, 0, 2, [UIntPtr]::Zero)
[SCKeys]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 180
$next = ''
try { $next = [System.Windows.Forms.Clipboard]::GetText() } catch {}
if ($previous) { [System.Windows.Forms.Clipboard]::SetText($previous) } else { [System.Windows.Forms.Clipboard]::Clear() }
$method = 'none'
$text = ''
if ($next -and $next -ne $sentinel) { $method = 'clipboard'; $text = $next }
[pscustomobject]@{ ok = $true; text = $text; method = $method } | ConvertTo-Json -Compress
