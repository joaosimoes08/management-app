# Publicar no GitHub

O repositório Git local está inicializado na branch `main` e já tem um commit-baseline. Ainda não existe remote.

```powershell
git branch -M main
git remote add origin https://github.com/UTILIZADOR/NOME-DO-REPOSITORIO.git
git push -u origin main
```

Antes de `git add .`, confirmar que `.env`, `apps/web/.env.local`, `node_modules`, builds e caches aparecem como ignorados. Nunca publicar credenciais reais; usar os ficheiros `.env.example` como referência.
