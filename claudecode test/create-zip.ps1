$source = "C:\Users\User\claudecode test"
$dest = "C:\Users\User\Downloads\flopfish-fc.zip"

# Remove old ZIP
if (Test-Path $dest) { Remove-Item $dest }

# Files to include
$items = @(
    "$source\index.html",
    "$source\main.js",
    "$source\net.js",
    "$source\firebase-config.js",
    "$source\Dockerfile",
    "$source\.gitignore",
    "$source\README.md",
    "$source\.claude",
    "$source\assets",
    "$source\server"
)

# Create ZIP
Compress-Archive -Path $items -DestinationPath $dest -Force

# Show result
$zip = Get-Item $dest
Write-Host "✅ ZIP created: $($zip.FullName)"
Write-Host "📦 Size: $([math]::Round($zip.Length/1MB, 1)) MB"
