# notify.ps1 — Notification Windows en cas d'échec du canari.
#
# Un toast plutôt qu'une boîte de dialogue : il reste dans le centre de
# notifications, donc l'alerte survit à une absence au moment de l'exécution.
# Repli sur une info-bulle de la zone de notification si l'API toast échoue
# (session distante, stratégie de groupe, build ancienne).
#
# Usage : powershell -ExecutionPolicy Bypass -File notify.ps1 -Title "..." -Message "..."

param(
    [string]$Title = 'Canari Auchan Drive',
    [string]$Message = 'Des contrôles ont échoué.'
)

function Show-Toast {
    param([string]$Title, [string]$Message)

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
        [Windows.UI.Notifications.ToastTemplateType]::ToastText02)

    $texts = $template.GetElementsByTagName('text')
    $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
    $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null

    # Les toasts exigent un AppId connu du système : celui de PowerShell convient.
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
    $notifier.Show([Windows.UI.Notifications.ToastNotification]::new($template))
}

function Show-Balloon {
    param([string]$Title, [string]$Message)

    Add-Type -AssemblyName System.Windows.Forms
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Warning
    $icon.Visible = $true
    $icon.ShowBalloonTip(20000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Warning)
    Start-Sleep -Seconds 12
    $icon.Dispose()
}

try {
    Show-Toast -Title $Title -Message $Message
} catch {
    try { Show-Balloon -Title $Title -Message $Message } catch { exit 1 }
}
