# Fork pessoal de Karytonn

Este fork mantém a criação de squads, personas, pipelines, checkpoints e integrações do Opensquad. As alterações protegem dados locais e tornam explícitas as ações com efeitos externos. O pacote está marcado como privado para impedir publicação acidental no npm.

## Usar em outras instalações

1. Clone `https://github.com/Karytonn/opensquad-karytonndev.git` em uma pasta dedicada. Use uma versão/commit revisado. Enquanto esta correção estiver em revisão, selecione a branch `security/personal-fork-hardening`.
2. Na pasta do fork, execute `npm ci --ignore-scripts`.
3. Abra um terminal na pasta de destino da instalação e execute:

   ```text
   node "C:/caminho/do/fork/bin/opensquad.js" init
   ```

   O assistente configura o IDE escolhido. No Windows, substitua o caminho pelo caminho real; no Linux/macOS use o caminho correspondente. Node e npm precisam estar disponíveis. O setup interativo instala as dependências e Chromium.

4. Para atualizar uma instalação existente, execute **na pasta dessa instalação**:

   ```text
   node "C:/caminho/do/fork/bin/opensquad.js" update --skills
   ```

   Sem `--skills`, a atualização preserva as skills existentes. Com a opção, substitui as skills presentes no catálogo desta versão, incluindo o criador de skills, após salvar backups em `_opensquad/_backups/skills/`. Skills personalizadas fora do catálogo são mantidas. Revise e reaplique personalizações a partir dos backups quando necessário.

5. Depois de atualizar, execute `npm ci --prefix dashboard --ignore-scripts` na instalação para aplicar o lockfile corrigido. Reinicie o dashboard e recarregue a página: o token de sessão muda quando o servidor reinicia.

Não use `npx opensquad@latest` para atualizar este fork: esse comando busca a distribuição original. Não execute init/update dentro do próprio checkout do fork; use uma pasta de projeto separada.

## Mudanças de comportamento

- A migração de memória mantém todo o conteúdo anterior, cria backup único e acrescenta somente seções ausentes.
- O dashboard é local, em loopback, com validação de Host/Origin e token de sessão. A interface recebe esse token automaticamente. Não é um serviço de hospedagem pública nem um painel multiusuário.
- `--dry-run` do publicador é offline e não exige credenciais. `--integration-test --allow-public-upload` faz uploads reais e cria containers sem publicar. `--publish --allow-public-upload` faz a publicação aprovada. Uma chamada sem modo explícito falha.
- Imagens precisam ser JPEG, de até 10 MiB, dentro de `squads/` ou de uma pasta explicitamente escolhida com `--images-root`. Os uploads no imgBB expiram em uma hora; uma publicação precisa concluir dentro desse período.
- Tokens da Meta são enviados no cabeçalho de autorização. Segredos devem ser configurados localmente; nunca colados no chat.
- Skills são copiadas da distribuição local do fork. Instalação automática de skills de uma branch remota foi removida. MCPs distribuídos usam versões exatas; fixar uma versão melhora a previsibilidade, mas não certifica a segurança do fornecedor.
- O servidor de renderização escuta somente em loopback. O visualizador escolhe outra porta quando a solicitada já está ocupada, sem encerrar outros processos.
- O visualizador escapa dados incorporados na página e exige token para gravar feedback. A exportação estática continua disponível.
- Configurações MCP existentes, memórias e squads são preservados pelo atualizador. Regras de proteção são acrescentadas ao `.gitignore` sem substituir regras pessoais.

## Verificação

```text
npm test
npm run lint
npm ci --prefix dashboard --ignore-scripts
npm test --prefix dashboard
npm run build --prefix dashboard
python -m pip install PyYAML==6.0.3
python -m unittest discover -s tests -p "test_*.py"
```

A CI executa essas verificações no Windows e no Ubuntu. Os testes de segurança não publicam conteúdo nem enviam imagens reais. A validação JPEG verifica formato básico/assinatura, não substitui um decodificador completo de imagens. Checkpoints continuam sujeitos às permissões do IDE; conteúdo externo não concede autorização para ações.
