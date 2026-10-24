Add-Type -AssemblyName System.Speech
try {
    $reco = New-Object System.Speech.Recognition.SpeechRecognitionEngine("MS-3082-80-DESK")
    $reco.SetInputToDefaultAudioDevice()
    $dict = New-Object System.Speech.Recognition.DictationGrammar
    $reco.LoadGrammar($dict)
    Write-Output "DICTATION_GRAMMAR_LOADED_OK"
} catch {
    Write-Output "ERROR: $_"
}
