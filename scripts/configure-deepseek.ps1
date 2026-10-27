param(
    [string]$EnvPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env'),
    [ValidateSet('DeepSeek', 'TMDB')][string]$Provider = 'DeepSeek'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = '光幕 · 配置 ' + $Provider
$form.ClientSize = New-Object System.Drawing.Size(520, 270)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$form.BackColor = [System.Drawing.Color]::FromArgb(247, 248, 250)
$form.Tag = 'cancelled'

$title = New-Object System.Windows.Forms.Label
$title.Text = if ($Provider -eq 'TMDB') { '填写 TMDB Read Access Token' } else { '填写你的 DeepSeek API Key' }
$title.Location = New-Object System.Drawing.Point(24, 22)
$title.Size = New-Object System.Drawing.Size(470, 30)
$title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 13, [System.Drawing.FontStyle]::Bold)

$description = New-Object System.Windows.Forms.Label
$description.Text = if ($Provider -eq 'TMDB') { '也支持 v3 API Key。只保存到本机，不会发送到聊天中。' } else { '密钥只保存到本机项目配置，不会发送到聊天中。' }
$description.Location = New-Object System.Drawing.Point(24, 60)
$description.Size = New-Object System.Drawing.Size(470, 25)

$keyBox = New-Object System.Windows.Forms.TextBox
$keyBox.Location = New-Object System.Drawing.Point(24, 98)
$keyBox.Size = New-Object System.Drawing.Size(470, 32)
$keyBox.UseSystemPasswordChar = $true
$keyBox.AccessibleName = $Provider + ' API credential'
$keyBox.TabIndex = 0

$status = New-Object System.Windows.Forms.Label
$status.Text = '保存位置：' + [System.IO.Path]::GetFullPath($EnvPath)
$status.Location = New-Object System.Drawing.Point(24, 143)
$status.Size = New-Object System.Drawing.Size(470, 44)
$status.ForeColor = [System.Drawing.Color]::FromArgb(78, 84, 96)

$save = New-Object System.Windows.Forms.Button
$save.Text = '保存并连接'
$save.Location = New-Object System.Drawing.Point(342, 210)
$save.Size = New-Object System.Drawing.Size(152, 36)
$save.TabIndex = 1

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = if ($Provider -eq 'TMDB') { '稍后填写' } else { '取消' }
$cancel.Location = New-Object System.Drawing.Point(236, 210)
$cancel.Size = New-Object System.Drawing.Size(94, 36)
$cancel.TabIndex = 2
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

$save.Add_Click({
    $credential = $keyBox.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($credential) -or $credential.Length -gt 8000 -or $credential -notmatch '^[A-Za-z0-9_.-]+$') {
        $status.Text = '请粘贴完整密钥，检查是否包含空格或引号。'
        $status.ForeColor = [System.Drawing.Color]::FromArgb(165, 38, 38)
        $keyBox.Focus()
        return
    }
    try {
        $destination = [System.IO.Path]::GetFullPath($EnvPath)
        $contents = if ([System.IO.File]::Exists($destination)) { [System.IO.File]::ReadAllText($destination) } else { '' }
        $field = if ($Provider -eq 'TMDB') { if ($credential -match '^[a-fA-F0-9]{32}$') { 'TMDB_API_KEY' } else { 'TMDB_ACCESS_TOKEN' } } else { 'DEEPSEEK_API_KEY' }
        if ($Provider -eq 'TMDB') {
            $otherField = if ($field -eq 'TMDB_API_KEY') { 'TMDB_ACCESS_TOKEN' } else { 'TMDB_API_KEY' }
            $contents = [regex]::Replace($contents, '(?m)^' + $otherField + '=[^\r\n]*', $otherField + '=')
        }
        $newLine = $field + '=' + $credential
        $pattern = '(?m)^' + $field + '=[^\r\n]*'
        if ([System.Text.RegularExpressions.Regex]::IsMatch($contents, $pattern)) {
            $replacement = [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $newLine }
            $contents = [System.Text.RegularExpressions.Regex]::Replace($contents, $pattern, $replacement)
        } else {
            $contents = $contents.TrimEnd() + "`r`n" + $newLine + "`r`n"
        }
        [System.IO.File]::WriteAllText($destination, $contents, (New-Object System.Text.UTF8Encoding($false)))
        $form.Tag = 'saved'
        $keyBox.Clear()
        $credential = $null
        $newLine = $null
        $contents = $null
        $form.Close()
    } catch {
        $status.Text = '保存失败，请检查项目配置文件是否可写。'
        $status.ForeColor = [System.Drawing.Color]::FromArgb(165, 38, 38)
    }
})

$form.Controls.AddRange(@($title, $description, $keyBox, $status, $save, $cancel))
$form.AcceptButton = $save
$form.CancelButton = $cancel
$form.Add_Shown({ $form.Activate(); $keyBox.Focus() })
[void]$form.ShowDialog()
$keyBox.Clear()
$result = $form.Tag
$form.Dispose()
if ($result -eq 'saved') { Write-Output ($Provider.ToUpperInvariant() + '_CONFIGURATION_SAVED') } else { Write-Output ($Provider.ToUpperInvariant() + '_CONFIGURATION_CANCELLED') }
