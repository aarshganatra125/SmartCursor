$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SCWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [SCWin]::GetForegroundWindow()
$builder = New-Object System.Text.StringBuilder 512
[void][SCWin]::GetWindowText($hwnd, $builder, $builder.Capacity)
$processId = [uint32]0
[void][SCWin]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
$name = if ($proc) { $proc.ProcessName } else { '' }
$path = if ($proc -and $proc.Path) { $proc.Path } else { '' }
[pscustomobject]@{
  ok = $true
  name = $name
  bundleId = $path
  pid = $processId
  title = $builder.ToString()
} | ConvertTo-Json -Compress
