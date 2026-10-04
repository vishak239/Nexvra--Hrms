# Registers the two Nexvra HRMS background jobs in Windows Task Scheduler for the current user
# (no administrator rights needed). Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\register-scheduled-tasks.ps1
# Remove them again with:  ... -File deploy\windows\register-scheduled-tasks.ps1 -Remove
param([switch]$Remove)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$backend = Join-Path $root "backend"
$pythonw = Join-Path $backend ".venv\Scripts\pythonw.exe"   # pythonw: no console window
$runner = Join-Path $PSScriptRoot "run_manage.pyw"            # output -> logs\scheduled-tasks.log
$tasks = @(
    @{ Name = "Nexvra HRMS - attendance rules"; Args = "reconcile_attendance --quiet";
       Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2) },
    @{ Name = "Nexvra HRMS - backup"; Args = "backup_hrms";
       Trigger = New-ScheduledTaskTrigger -Daily -At "02:30" }
)

foreach ($t in $tasks) {
    if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
    }
    if ($Remove) { Write-Host "Removed: $($t.Name)"; continue }
    if (-not (Test-Path $pythonw)) { throw "Not found: $pythonw (create the backend virtual environment first)" }
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$runner`" $($t.Args)" -WorkingDirectory $backend
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger -Settings $settings `
        -Description "Nexvra HRMS ($($t.Args))" | Out-Null
    Write-Host "Registered: $($t.Name)"
}
