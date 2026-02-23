# ─────────────────────────────────────────────────────────────────────────────
# setup-bbps-branch.ps1
#
# Run this script ONCE from the project root to:
#   1. Create the feature/bbps-cc-billpayment branch
#   2. Stage only the BBPS scaffold files
#   3. Commit and push to origin
#
# Usage:
#   cd d:\Projects\pos-server
#   .\scripts\setup-bbps-branch.ps1
# ─────────────────────────────────────────────────────────────────────────────

$BRANCH = "feature/bbps-cc-billpayment"

Write-Host "`n[1/5] Fetching latest from origin..." -ForegroundColor Cyan
git fetch origin

Write-Host "`n[2/5] Creating and switching to branch: $BRANCH" -ForegroundColor Cyan
git checkout -b $BRANCH

Write-Host "`n[3/5] Staging only BBPS scaffold files..." -ForegroundColor Cyan
git add controllers/cc/bbps/bbpsCCBillController.js
git add services/cc/bbps/bbpsCCBillService.js
git add routes/cc/bbps/bbpsCCBillRoutes.js
git add .env.bbps.example
git add docs/bbps-cc-integration-guide.md

Write-Host "`n[4/5] Committing scaffold..." -ForegroundColor Cyan
git commit -m "feat: scaffold BBPS CC bill payment integration

- Add controller, service, route stubs under cc/bbps/
- Add .env.bbps.example with required BBPS env keys
- Add docs/bbps-cc-integration-guide.md for integrating developer"

Write-Host "`n[5/5] Pushing branch to origin..." -ForegroundColor Cyan
git push origin $BRANCH

Write-Host "`n✅ Branch '$BRANCH' pushed to GitHub." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS (do on GitHub.com):" -ForegroundColor Yellow
Write-Host "  1. Go to GitHub repo → Settings → Branches"
Write-Host "  2. Add branch protection rule for: feature/bbps-cc-billpayment"
Write-Host "     ✓ Require pull request before merging"
Write-Host "     ✓ Require at least 1 approval"
Write-Host "     ✓ Do NOT check 'Allow force pushes'"
Write-Host "  3. Go to Settings → Collaborators → Add the developer"
Write-Host "     Role: Write (so they can push only to feature branches)"
Write-Host ""
Write-Host "Share with the developer:" -ForegroundColor Yellow
Write-Host "  - Branch name: $BRANCH"
Write-Host "  - File: docs/bbps-cc-integration-guide.md"
Write-Host "  - File: .env.bbps.example (they fill in BBPS credentials you provide separately)"
