# Opensquad

Ambiente de squads de agentes de IA instalado a partir do fork pessoal de Karytonn.

## Como Usar

Abra esta pasta no IDE configurado e digite `/opensquad`. O menu permite configurar o perfil da empresa, criar squads e executar os existentes.

Os arquivos dos squads ficam em `squads/`. Cada execução salva seus resultados na pasta de saída do squad.

## Dashboard

```powershell
npm.cmd run dev --prefix dashboard
```

Abra o endereço local informado no terminal. No Linux/macOS, use `npm` em vez de `npm.cmd`.

## Atualizar

Primeiro atualize sua cópia do instalador com `git pull --ff-only origin main` e `npm ci --ignore-scripts`. Depois, nesta pasta, execute:

```text
node "C:/caminho/do/fork/bin/opensquad.js" update --skills
npm ci --prefix dashboard --ignore-scripts
```

A atualização cria backups das skills substituídas. Reinicie o dashboard depois de atualizar.

## Dados locais

Configure credenciais apenas na máquina. Não versione `.env`, perfis de navegador, backups ou informações confidenciais. Checkpoints dependem das permissões do IDE. Execuções podem consumir créditos dos provedores.

## How to Use

Open this project in your configured IDE and type `/opensquad`. Keep credentials local. Update from the personal fork's `main` branch using the installer described above.
