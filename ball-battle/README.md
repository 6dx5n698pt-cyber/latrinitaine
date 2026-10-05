# Ball Battle Royale – générateur de vidéos

Même modèle que @ballbattleroyale : 8 pays, chacun commence avec 110 fils tendus vers sa portion de l'anneau.
- Le nombre sous chaque boule = son nombre de fils.
- Quand une boule touche le bord, elle crée de nouveaux fils à cet endroit (max 110).
- Quand une boule passe sur les fils d'un autre pays, elle les casse.
- Plus de fils = éliminé (« ● SLOW MOTION » juste avant, explosion + son, « X OUT »).
- Chocs entre boules : rebond + son « tock ». Final Four / Three / Final, puis « X WINS! ».
Format TikTok 1080×1920, 30 fps, ~25-30 s.

## Générer de nouvelles vidéos
```bash
pip install playwright numpy
npm pack flag-icons && tar xzf flag-icons-*.tgz   # drapeaux SVG -> ./package/flags
python3 make.py sim europe 1 2 3      # test rapide : durée + gagnant de chaque seed
python3 make.py render europe 13      # rend battle_europe_13.mp4
```
Chaque seed = une partie différente. Listes de 8 pays (`ROSTERS`), textes, PV et dégâts se règlent en haut de `make.py`.
