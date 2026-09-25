# Guia de Configuração: GitHub Personal Access Token (PAT) & Integração MCP

Este guia orienta passo a passo como gerar, solicitar ao mentor/líder técnico e configurar seu token do GitHub no Paperclip, de forma totalmente direta e segura, sem intermediários ou serviços externos em nuvem.

---

## 1. Por que usar o Personal Access Token (PAT)?

No Paperclip, o agente interage com o GitHub para ler código, inspecionar pull requests, criar branches, commitar alterações e interagir via Model Context Protocol (MCP).

Utilizar um **Personal Access Token (PAT)** garante:
- **Privacidade total**: Suas credenciais permanecem exclusivamente no cofre criptografado da sua instância local (`company_secrets`).
- **Autonomia**: Nenhuma dependência de servidores ou serviços de autenticação de terceiros.
- **Controle granular**: Você define exatamente a quais repositórios e permissões o agente tem acesso.

---

## 2. Como gerar seu token no GitHub

Você pode optar por um **Fine-grained Token** (mais seguro e restrito a repositórios específicos) ou um **Token Clássico** (mais simples de configurar).

### Opção A: Fine-grained Personal Access Token (Recomendado)

1. Faça login na sua conta em [github.com](https://github.com).
2. Clique na sua foto de perfil no canto superior direito e selecione **Settings** (Configurações).
3. Na barra lateral esquerda, desça até o final e clique em **Developer settings** (Configurações do desenvolvedor).
4. Em **Personal access tokens**, clique em **Fine-grained tokens** e depois no botão **Generate new token**.
5. Preencha as informações:
   - **Token name**: ex. `Paperclip Agent - Meu Projeto`
   - **Expiration**: Escolha a validade (ex: 30, 60 ou 90 dias).
   - **Resource owner**: Selecione sua conta pessoal ou a organização do projeto.
   - **Repository access**: Escolha **Only select repositories** e marque o repositório que o agente irá utilizar.
6. Em **Permissions** (Permissões de repositório), selecione:
   - `Contents`: **Read and write** (para ler código, criar branches e commitar).
   - `Pull requests`: **Read and write** (para abrir e gerenciar PRs).
   - `Issues`: **Read and write** (para ler e atualizar tarefas vinculadas).
   - `Metadata`: **Read-only** (marcado automaticamente).
7. Clique em **Generate token** no final da página.
8. **Copie o token gerado** (começa com `github_pat_...`). *Atenção: o GitHub não exibirá esse valor novamente.*

---

### Opção B: Token (Classic)

1. Em **Developer settings** > **Personal access tokens**, clique em **Tokens (classic)**.
2. Clique em **Generate new token** > **Generate new token (classic)**.
3. Preencha a nota (ex: `Paperclip Agent`) e defina a data de expiração.
4. Na lista de escopos, marque a caixa:
   - ✅ **`repo`** (Full control of private repositories - inclui código, commits e PRs).
5. Clique em **Generate token**.
6. **Copie o token gerado** (começa com `ghp_...`).

---

## 3. Está em Treinamento, Mentoria ou Organização Corporativa? (Pedir ao Mentor)

Se você faz parte de um programa de mentoria, estágio, treinamento corporativo ou onboarding em uma empresa:
- É comum que repositórios pertençam a organizações com restrições de acesso (SAML/SSO).
- Nesse caso, você pode **solicitar ao seu mentor ou líder técnico** que forneça um token de serviço compartilhado da equipe ou autorize o seu usuário no repositório.

### Template para solicitar ao seu Mentor / Líder Técnico:

> *"Olá [Nome do Mentor / Líder Técnico],*  
> *Estou configurando o meu ambiente de agentes no Paperclip para atuar no projeto [Nome do Projeto / Repositório].*  
> *Poderia, por gentileza, me fornecer um token de acesso (GitHub PAT) com permissão de leitura/escrita no repositório, ou liberar acesso para que eu gere meu token pessoal com escopo `repo`?"*

---

## 4. Como adicionar o token no Paperclip

Você pode configurar o token no Paperclip de três formas complementares:

### Método 1: Pela Interface de Conexões (Recomendado)

1. No menu principal do Paperclip, clique em **Apps** (ou navegue para `/apps`).
2. Localize o card do **GitHub** e clique em **Connect** (Conectar).
3. Na primeira etapa (**Access**):
   - Escolha **My GitHub account** (para uso nas tarefas sob sua responsabilidade) ou **A dedicated account for an agent** (para fixar em um agente específico).
   - Escolha quais agentes podem utilizar essa conexão (ex: *Any agent* ou agentes específicos).
   - Clique em **Save and continue**.
4. Na segunda etapa (**Add your key**):
   - No campo **GitHub token**, cole o seu token (`ghp_...` ou `github_pat_...`).
   - Clique em **Connect**.
5. Pronto! A conexão agora está ativa e pronta para ser usada pelos agentes.

---

### Método 2: Via Variáveis de Ambiente / Secrets do Agente

Se preferir configurar diretamente como variável de ambiente para scripts, Git CLI ou ferramentas de terminal:

1. Acesse **Company Settings** > **Secrets** (ou abra as configurações do seu Agente > **Environment Variables**).
2. Crie uma nova chave de ambiente:
   - **Nome da chave**: `GITHUB_TOKEN` (ou `GH_TOKEN`)
   - **Valor**: cole o seu token do GitHub (`ghp_...` ou `github_pat_...`)
3. O Paperclip injetará essa variável nas execuções do agente, permitindo comandos Git nativos como `git clone`, `git push` e `gh pr create`.

---

### Método 3: Via Conexão MCP Manual (Model Context Protocol)

O Paperclip suporta servidores MCP remotos ou locais para o GitHub:

#### A. Servidor MCP Remoto (GitHub Copilot MCP)
1. Vá em **Apps** > **Connect your own tool** (ou `/apps/byo`).
2. Insira a URL: `https://api.githubcopilot.com/mcp/`
3. Em autenticação, configure o header:
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer <SEU_TOKEN_GITHUB>`
4. Conclua a conexão.

#### B. Servidor MCP Local (Stdio)
Se estiver rodando o servidor MCP oficial via Node.js:
- Comando de execução:
  ```sh
  npx -y @modelcontextprotocol/server-github
  ```
- Variável de ambiente necessária:
  ```sh
  GITHUB_PERSONAL_ACCESS_TOKEN=<SEU_TOKEN_GITHUB>
  ```

---

## 5. Boas Práticas de Segurança

- 🔒 **Nunca compartilhe seu token em mensagens públicas** ou comite em repositórios abertos.
- ⏱️ **Defina um prazo de expiração**: Evite tokens "sem expiração" (*No expiration*). Renove periodicamente.
- 🎯 **Princípio do menor privilégio**: Conceda acesso apenas aos repositórios necessários para a tarefa.
- 🛑 **Revogação imediata**: Caso suspeite que o token foi exposto, acesse imediatamente `github.com/settings/tokens` e clique em **Delete** / **Revoke**.
