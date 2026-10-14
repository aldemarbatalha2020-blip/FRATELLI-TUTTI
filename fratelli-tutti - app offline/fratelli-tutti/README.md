# Fratelli Tutti

Site interno do ministério de música católico Fratelli Tutti.
Projeto independente, sem qualquer ligação com outros sites.

## Seções

- **Mural do Fratelli**: avisos. Visitantes veem só os públicos; membros veem todos.
- **Abba Musical**: pastas de repertório e cifras (só membros).
- **Galeria da Mídia**: três grades (fotos, reels, vídeos), com reações, comentários e compartilhamento.

## Acessos

| Perfil | Como entra | O que pode |
|---|---|---|
| Visitante | sem chave | ver avisos públicos; reagir, comentar e compartilhar na galeria |
| Coordenação | `CHAVE_COORDENACAO` | postar avisos (público ou só ministério); monitorar e apagar repertório, galeria e mural |
| Equipe musical | `CHAVE_MUSICAL` | criar pastas; adicionar e editar cifras |
| Equipe de produção | `CHAVE_PRODUCAO` | ver avisos e repertórios (sem editar); enviar fotos e vídeos |

## Uso offline

O site é um aplicativo instalável (PWA). Na primeira visita com internet ele guarda no aparelho:

- o próprio site (abre mesmo sem internet);
- avisos, pastas, cifras e listas da galeria (os membros baixam todas as cifras automaticamente);
- fotos já vistas e vídeos marcados com "Salvar para ver offline".

Sem internet, a alteração de texto (avisos, cifras, pastas, comentários, reações) fica numa fila no aparelho e é enviada sozinha quando a conexão volta. Envio de fotos e vídeos precisa de internet. Entrar e sair também.

Para instalar: no celular, abra o site e escolha "Instalar app" ou "Adicionar à tela inicial".

## Publicar no Render

1. Crie um repositório novo no GitHub (ex.: `fratelli-tutti`) e envie estes arquivos.
2. No Render: **New → Blueprint**, escolha o repositório. O `render.yaml` cria o serviço web e o banco Postgres.
3. Quando pedir, preencha `CHAVE_COORDENACAO`, `CHAVE_MUSICAL` e `CHAVE_PRODUCAO` com chaves diferentes e difíceis de adivinhar.
4. Aguarde o deploy e abra o endereço `.onrender.com` do serviço.

## Rodar localmente

```bash
npm install
export DATABASE_URL=postgres://usuario:senha@localhost:5432/fratelli
export CHAVE_COORDENACAO=coord123 CHAVE_MUSICAL=musica123 CHAVE_PRODUCAO=prod123
npm start
```

## Observações

- Fotos e vídeos ficam guardados no banco de dados (limite de 50 MB por arquivo). O plano gratuito do banco no Render tem espaço pequeno e expira após um período; para uso contínuo, use um plano pago ou migre as mídias para um armazenamento de arquivos.
- No plano gratuito o serviço "dorme" após minutos sem uso, e o primeiro acesso demora um pouco.
