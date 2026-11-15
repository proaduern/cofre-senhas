' ============================================================
'  Iniciar Cofre.vbs
'  ------------------------------------------------------------
'  Sobe o servidor local do cofre, sem abrir janela preta.
'  Coloque um atalho deste arquivo na pasta Inicializar do
'  Windows para que o app funcione sempre, sem voce fazer nada.
'
'  O servidor escuta SOMENTE em 127.0.0.1, ou seja, so este
'  computador enxerga. Ninguem na mesma rede Wi-Fi alcanca.
' ============================================================

Option Explicit

Dim sh, fso, pasta, cmd

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' a pasta onde este proprio script esta
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta

' --bind 127.0.0.1 = nao expoe o app para a rede local
cmd = "python -m http.server 5173 --bind 127.0.0.1"

' 0 = janela escondida, False = nao espera terminar
sh.Run cmd, 0, False
