# Publicar no GitHub

O repositório Git local já foi inicializado. Ainda não existe remote nem commit.

```powershell
git add .
git commit -m "Initial project import"
git branch -M main
git remote add origin https://github.com/UTILIZADOR/NOME-DO-REPOSITORIO.git
git push -u origin main
```

Antes de `git add .`, confirmar que `.env`, `apps/web/.env.local`, `node_modules`, builds e caches aparecem como ignorados. Nunca publicar credenciais reais; usar os ficheiros `.env.example` como referência.
