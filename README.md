# Cofre

Cofre de senhas pessoal que roda no navegador, no computador e no celular.

- **Criptografia local**: AES-256-GCM, chave derivada da senha-mestra com
  PBKDF2-SHA256 (600.000 iterações). A senha-mestra nunca sai do dispositivo.
- **Sincronização**: um único arquivo cifrado (`cofre.enc`) no Google Drive do
  próprio usuário, via escopo `drive.file` — o app só enxerga o que ele criou.
- **Importação**: CSV do Chrome, Bitwarden, KeePass, LastPass, 1Password e
  Firefox; notas soltas do Google Keep; exportações do Google Takeout.
- **PWA**: instalável, funciona offline.

Sem dependências, sem build, sem servidor próprio.

A documentação completa — instalação, configuração do Google Drive, modelo de
segurança e backup — está em **[LEIAME.md](LEIAME.md)**.

> Este repositório contém apenas o código do aplicativo. Nenhum dado de cofre,
> credencial ou senha é versionado aqui.
