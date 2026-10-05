# Ball Battle Royale – générateur de vidéos

32 pays dans une arène ; chaque choc retire des PV (son « tock »), une boule à 0 PV explose (son « boom »).
Format TikTok 1080×1920, 30 fps, ~30-38 s.

## Générer de nouvelles vidéos
```bash
pip install playwright numpy
npm pack flag-icons && tar xzf flag-icons-*.tgz   # drapeaux SVG -> ./package/flags
python3 make.py sim 1 2 3        # test rapide : durée + gagnant de chaque seed
python3 make.py render 7 42      # rend battle_7.mp4, battle_42.mp4
```
Chaque seed = une partie différente. Pays, couleurs, textes, PV et dégâts se règlent en haut de `make.py`.
