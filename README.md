# Opensquad — Karytonn

Fork pessoal para criar e executar squads de agentes de IA no IDE. Inclui as correções de segurança, preservação de memória e atualização de instalações.

## Instalação

Pré-requisitos: Git e Node.js com npm. Use uma versão LTS suportada do Node.js.

No PowerShell, baixe a distribuição em uma pasta dedicada:

```powershell
git clone --branch main https://github.com/Karytonn/opensquad-karytonndev.git C:\dev\opensquad-base
cd C:\dev\opensquad-base
npm.cmd ci --ignore-scripts
```

Inicialize o ambiente em uma pasta de projeto separada:

```powershell
New-Item -ItemType Directory -Force C:\dev\meu-projeto | Out-Null
cd C:\dev\meu-projeto
node C:\dev\opensquad-base\bin\opensquad.js init
```

Escolha o idioma e o IDE no assistente. O setup instala as dependências e o Chromium. No Linux/macOS, adapte os caminhos e use `npm` em vez de `npm.cmd`.

## Uso

Abra a pasta do projeto no IDE escolhido e digite:

```text
/opensquad
```

Configure o perfil da empresa e crie ou execute um squad pelo menu. As integrações exigem configuração local das credenciais.

## Atualização

Atualize a distribuição e aplique as mudanças na instalação:

```powershell
cd C:\dev\opensquad-base
git pull --ff-only origin main
npm.cmd ci --ignore-scripts

cd C:\dev\meu-projeto
node C:\dev\opensquad-base\bin\opensquad.js update --skills
npm.cmd ci --prefix dashboard --ignore-scripts
```

A opção `--skills` substitui as skills do catálogo após criar backups. Sem essa opção, as skills existentes são preservadas. Memórias, squads e configurações MCP pessoais são mantidos.

## Dashboard

Na pasta do projeto:

```powershell
npm.cmd run dev --prefix dashboard
```

Abra o endereço local informado pelo terminal. Reinicie o servidor e recarregue a página após uma atualização.

## Configuração e segurança

- A branch mantida é `main`.
- Use o instalador deste fork; `npx opensquad@latest` busca a distribuição original.
- Configure segredos localmente, sem enviá-los pelo chat ou adicioná-los ao Git.
- O modo `--dry-run` do publicador é offline. Publicação exige `--publish --allow-public-upload` e aprovação do conteúdo.
- Checkpoints orientam os agentes; as permissões efetivas são controladas pelo IDE.
- Execuções e integrações podem consumir créditos dos provedores.

Detalhes de manutenção e validação: [FORK.md](FORK.md). Informações de segurança: [SECURITY.md](SECURITY.md).
