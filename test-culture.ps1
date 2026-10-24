Add-Type -AssemblyName System.Speech
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine("MS-3082-80-DESK")
$engine.SetInputToDefaultAudioDevice()
$choices = New-Object System.Speech.Recognition.Choices
$choices.Add(@("nova", "oye nova", "abre discord", "pon musica"))
$gb = New-Object System.Speech.Recognition.GrammarBuilder
$gb.Culture = $engine.RecognizerInfo.Culture
$gb.Append($choices)
$grammar = New-Object System.Speech.Recognition.Grammar($gb)
$engine.LoadGrammar($grammar)
Write-Output "SUCCESS_CULTURE_MATCHED: $($engine.RecognizerInfo.Culture.Name)"
