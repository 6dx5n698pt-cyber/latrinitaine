# Ball Battle Royale – générateur de vidéos

Même modèle que @ballbattleroyale : 8 pays à 110 PV placés en cercle, l'anneau est partagé en 8 territoires
(faisceaux de traits de chaque boule vers son territoire).
- Choc : la boule qui fonce sur l'autre lui retire des PV (son « tock »).
- Rebond sur son propre territoire : soin.
- Avant chaque mort : « ● SLOW MOTION », puis explosion (son « boom »), « X OUT », le tueur récupère le territoire.
- Final Four / Three / Final, puis « X WINS! ».
Format TikTok 1080×1920, 30 fps, ~33 s.

## Générer de nouvelles vidéos
```bash
pip install playwright numpy
npm pack flag-icons && tar xzf flag-icons-*.tgz   # drapeaux SVG -> ./package/flags
python3 make.py sim europe 1 2 3      # test rapide : durée + gagnant de chaque seed
python3 make.py render europe 13      # rend battle_europe_13.mp4
```
Chaque seed = une partie différente. Listes de 8 pays (`ROSTERS`), textes, PV et dégâts se règlent en haut de `make.py`.
