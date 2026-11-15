# Cofre de Senhas

Cofre pessoal de senhas que roda no PC e no celular Android, com os dados
sincronizados pelo seu Google Drive. O Drive guarda **um único arquivo cifrado**
(`cofre.enc`); a senha-mestra nunca sai do seu dispositivo.

---

## 1. Como rodar no PC

Dê dois cliques em **`Iniciar Cofre.vbs`**. Não abre janela nenhuma — o servidor
sobe em segundo plano, escutando apenas em `127.0.0.1` (ninguém na sua rede
Wi-Fi alcança). Depois abra <http://localhost:5173>.

Para não precisar fazer isso toda vez, coloque um atalho desse arquivo na pasta
de inicialização do Windows: tecle `Win+R`, digite `shell:startup`, e arraste
para lá um atalho do `Iniciar Cofre.vbs`.

### Instalar como aplicativo de verdade

Com o servidor rodando, abra <http://localhost:5173> no Chrome e clique no
ícone de instalar na barra de endereço (ou ⋮ → *Transmitir, salvar e
compartilhar* → *Instalar página como app*). O cofre ganha ícone próprio,
janela sem barra de navegação e entrada no menu Iniciar.

Ele continua precisando do servidor local no ar — por isso o atalho na
inicialização.

Se preferir pela linha de comando:

```bash
python -m http.server 5173 --bind 127.0.0.1
```

> Não abra o `index.html` com dois cliques (`file://`). O navegador bloqueia
> criptografia e módulos JavaScript nesse modo. Tem que ser por `http://localhost`
> ou por um endereço `https://`.

Na primeira vez o app pede para criar a **senha-mestra**. Depois disso:

- botão **+** (canto inferior direito): adicionar uma senha
- **Importar lista**: joga de uma vez o CSV que você já tem
- ícone **engrenagem**: configurações, backup, Google Drive
- ícone **cadeado**: bloqueia na hora (atalho `Ctrl+Shift+L`)

---

## 2. Onde colocar as senhas que você já tem

Tudo é processado dentro do navegador — nada é enviado para fora.

### a) Nota do Google Keep (o caminho mais rápido)

**O Keep não tem API pública para contas pessoais** — a API existe, mas só
para contas Google Workspace, e é voltada para administradores. Nenhum app
consegue se conectar na sua conta e ler as notas sozinho. Então o caminho é
levar o texto, e o app se vira com a bagunça:

1. Abra a nota no Keep (no PC: <https://keep.google.com>)
2. Clique dentro da nota, `Ctrl+A`, `Ctrl+C`
3. No cofre: *Importar lista* → cole na caixa → **Analisar**
4. Confira a prévia, corrija o que estiver trocado, desmarque o que não
   quiser → **Importar**

Não precisa arrumar nada antes. O formato mais comum é o mais simples —
**título numa linha, senha na linha de baixo**, sem rótulo nenhum:

```
ITAU RI                     ← título
aaabbbsss                   ← senha

TONHO MEU INSS              ← título
87797240434                 ← usuário (linha do meio)
@Antonio1962                ← senha (última linha sempre)
```

A regra é essa: num bloco, a **última linha solta é a senha**, as do meio são
o usuário. O app decide olhando o bloco inteiro, não linha por linha.

Também entende, misturados na mesma nota:

```
SENHAS IMPORTANTES          ← vira etiqueta nas entradas abaixo

Banco Inter                 ← título
login: 12345678             ← rótulo com dois-pontos
senha: Abc@123#

Netflix - pedro@email.com - NetFlix2024!     ← tudo numa linha

Gmail
pedro.reboucas@gmail.com    ← e-mail vira usuário sozinho
senha Trovao-Azul-77        ← rótulo sem dois-pontos

☑ Nubank                    ← marcador de lista é removido
  cpf 123.456.789-00
  senha: 4455

Wifi casa: minhasenhawifi   ← "coisa: senha" numa linha só

Mercado Livre | pedro123 | Ml#2024pass
https://mercadolivre.com.br ← link gruda na entrada de cima
```

Rótulos reconhecidos: `senha, password, pass, pin, código, chave` ·
`usuário, login, email, conta, cpf, matrícula` · `site, url, link` ·
`obs, nota, agência, telefone`. Funcionam com dois-pontos (`senha: abc`) e
sem (`senha abc`, `codigo acesso abc`). Separadores: `-` `—` `|` `/` `=` e
tabulação.

Detalhes que ele acerta e costumam derrubar parser simples:

- um rótulo sozinho numa linha (`cpf` sem valor) vira anotação, não usuário
- `Senha ICSEE` na primeira linha é **título**, não "a senha é ICSEE"
- uma segunda credencial no mesmo bloco (`codigo acesso xxx` logo abaixo da
  senha) vira anotação, não uma entrada órfã
- `RN+VACINAS` seguido de `MAE` (dois nomes em caixa alta) vira **etiqueta de
  grupo**, e `MAE` passa a ser o título

### Limitações conhecidas

- A etiqueta de grupo só marca o primeiro bloco abaixo dela. Se você tem
  `RN+VACINAS` cobrindo `MAE`, `PAI` e `MEU`, só `MAE` recebe a etiqueta —
  nos outros dois você adiciona na prévia, se quiser.
- Se a nota **não tiver nenhuma linha em branco** separando as entradas, o
  app não consegue saber onde uma acaba e a outra começa. Nesse caso, dê um
  Enter entre os blocos antes de colar.

**A prévia é editável de propósito.** Reconhecer texto escrito à mão é
palpite, não ciência: o app acerta a grande maioria, mas você revisa antes de
qualquer coisa entrar no cofre.

### b) Muitas notas de uma vez: Google Takeout

Para quem tem as senhas espalhadas em várias notas:

1. <https://takeout.google.com> → **Desmarcar tudo** → marque só **Keep** → exportar
2. Baixe e descompacte o `.zip`
3. No cofre: *Importar lista* → **Escolher arquivos** → selecione todos os
   `.json` (ou `.html`) da pasta `Keep`

O app lê os dois formatos, usa o título da nota como etiqueta e ignora o que
estiver na lixeira. Apague a pasta descompactada depois: ela está em texto puro.

### c) CSV de outro gerenciador

Mesmo modal. Reconhece Chrome/Google Senhas, Bitwarden, KeePass, LastPass,
1Password e Firefox pelo cabeçalho.

Para exportar do Chrome: `chrome://password-manager/settings` →
**Baixar arquivo**. Apague esse CSV depois — ele sai em texto puro.

### d) Digitar uma por uma

Botão **+**, usando o gerador (🎲) para as senhas novas.

---

## 3. Ligar o Google Drive (uma vez só)

O app não vem com credencial embutida: você cria a sua, de graça, e ela fica
só no seu navegador.

1. Entre em <https://console.cloud.google.com> com a sua conta Google.
2. **Criar projeto** → nome: `cofre-senhas`.
3. Menu → **APIs e serviços** → **Biblioteca** → procure **Google Drive API** → **Ativar**.
4. **APIs e serviços** → **Tela de permissão OAuth**:
   - Tipo: **Externo**
   - Nome do app: `Cofre`, e-mail de suporte: o seu
   - Deixe em **Testing** e adicione o seu e-mail em **Usuários de teste**
5. **Credenciais** → **Criar credenciais** → **ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**
   - **Origens JavaScript autorizadas**: adicione as duas
     - `http://localhost:5173`
     - a URL do GitHub Pages (passo 4), quando existir
6. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).
7. No app: engrenagem → cole o ID → **Conectar ao Drive** → **Salvar**.

Pronto. A partir daí o app sincroniza sozinho ao abrir e alguns segundos
depois de cada alteração; o botão ↻ força na hora.

**Observações honestas:**

- Não existe "segredo do cliente" aqui, e não é falha: em app de navegador o
  ID é público por natureza. A segurança vem do escopo e da cifragem.
- O escopo usado é `drive.file` — o app enxerga **apenas** os arquivos que ele
  mesmo criou. Ele não consegue ler o resto do seu Drive.
- O token do Google dura cerca de 1 hora. Quando vence, o app renova sozinho;
  de vez em quando aparece a janela do Google pedindo confirmação.
- Em modo **Testing** o Google mostra um aviso de "app não verificado". Para uso
  pessoal isso é normal e permanente — basta avançar.

---

## 4. Publicar e instalar no Android

O Android exige `https://` para criptografia e para instalar como app. A forma
gratuita mais simples é o GitHub Pages:

```bash
git init
git add .
git commit -m "Cofre de senhas"
```

Crie um repositório **privado** em <https://github.com/new>, e então:

```bash
git remote add origin https://github.com/SEU-USUARIO/cofre.git
git push -u origin main
```

No repositório: **Settings → Pages → Branch: main / root → Save**.
Em um ou dois minutos a URL fica no ar:
`https://SEU-USUARIO.github.io/cofre/`

> Repositório privado só serve o Pages em contas Pro. Em conta gratuita, use
> repositório público: **o código é público, o seu cofre não** — ele vive no
> seu Drive e no seu aparelho, cifrado, e nada sensível está nos arquivos.

Depois:

1. Acrescente essa URL nas **Origens JavaScript autorizadas** (passo 3.5).
2. Abra a URL no Chrome do Android → menu ⋮ → **Instalar aplicativo**.
3. No app recém-instalado: **Já tenho um cofre** → *Do Google Drive* → cole o
   mesmo ID do cliente → **Conectar e baixar** → digite a senha-mestra.

Os dois aparelhos passam a trabalhar no mesmo cofre.

---

## 5. Como funciona a segurança

```
senha-mestra ──PBKDF2-SHA256 (600.000 iterações)──► chave AES-256
                                                        │
cofre em JSON ──────── AES-256-GCM ────────────────────►│──► cofre.enc
                                                             (vai para o Drive)
```

- **PBKDF2 com 600.000 iterações** (recomendação OWASP) torna a tentativa de
  adivinhar a senha-mestra lenta e cara.
- **AES-256-GCM** cifra e autentica ao mesmo tempo: senha errada e arquivo
  adulterado dão o mesmo resultado — o cofre não abre. Testado: alterar um
  único byte do arquivo, ou até o cabeçalho em claro, invalida tudo.
- A chave é um `CryptoKey` **não extraível** e vive só na memória. Bloqueou,
  acabou.
- No disco (IndexedDB) fica apenas o envelope cifrado. Verificado: nenhum
  trecho de senha, usuário ou título aparece em texto no que é gravado.
- **Bloqueio automático** por inatividade (padrão: 5 minutos) e ao voltar de
  segundo plano.
- Senha copiada é **apagada da área de transferência** depois de 30 segundos.

### Conflito entre os dois aparelhos

Cada entrada carrega a data da última alteração, e exclusões viram *tombstones*.
Na sincronização o app mescla entrada por entrada, e a versão mais recente de
cada uma vence. Resultado: editar no celular e no PC ao mesmo tempo não apaga
trabalho, e uma exclusão feita num aparelho não "ressuscita" no outro.
O Drive ainda guarda o histórico de versões do arquivo, como rede extra.

---

## 6. Backup — leia esta parte

**Se você esquecer a senha-mestra, os dados são irrecuperáveis.** Não existe
"recuperar senha": é essa a razão de o Google não conseguir ler o arquivo.

Faça isto hoje:

1. Anote a senha-mestra em papel e guarde fora do computador.
2. Configurações → **Exportar cofre cifrado**. Guarde o `.enc` num pendrive.
   Ele continua cifrado — é seguro mesmo que alguém ache o pendrive.
3. Repita a exportação de vez em quando.

Para restaurar: tela inicial → **Já tenho um cofre** → *arquivo de backup*.

---

## 7. Estrutura dos arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | todas as telas e modais |
| `css/style.css` | tema escuro, responsivo |
| `js/crypto.js` | derivação de chave, AES-GCM, gerador de senhas |
| `js/store.js` | IndexedDB (só o envelope cifrado e as preferências) |
| `js/vault.js` | modelo do cofre, CRUD, mesclagem entre aparelhos |
| `js/drive.js` | OAuth do Google e API do Drive |
| `js/importer.js` | leitura de CSV de outros gerenciadores |
| `js/keep.js` | leitura de notas do Keep (texto solto, Takeout .json/.html) |
| `js/app.js` | interface, eventos, sincronização |
| `sw.js` | funcionamento offline (só o "casco" do app) |
| `manifest.json` | instalação como aplicativo |

Sem dependências, sem build, sem servidor próprio. O que está aqui é o que roda.

---

## 8. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Tela branca ao abrir o arquivo | abriu em `file://`; use `http://localhost:5173` |
| "a origem … não foi autorizada" | falta a URL em *Origens JavaScript autorizadas* |
| "Acesso negado" no Google | seu e-mail não está em *Usuários de teste* |
| A janela do Google não abre | pop-ups bloqueados para o site |
| Não aparece "Instalar aplicativo" | o site precisa estar em `https://`, não em IP de rede local |
| Botão de copiar não funciona | a cópia exige `https://` ou `localhost` |

---

## 9. O que ainda dá para acrescentar

- Desbloqueio por **biometria** (WebAuthn/passkey) no Android
- Códigos **TOTP** (2FA) dentro do cofre
- **APK** de verdade empacotando com Capacitor
- Verificação de senhas vazadas (k-anonimato da API Have I Been Pwned)
- Campos personalizados e anexos
