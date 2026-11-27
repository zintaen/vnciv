# Extra crop tables of the NSO yearbook 2025 (Part I, 63 former provinces) for the society stream's agriculture lenses.
# Same shape as spec63.SPECS; used as: emit.py BOOK.json data/stats/2025 "<URL> (Part I, 63 provinces)" crops_spec
# Cassava, tea and orange are "of which" lists (only the main producing provinces), so they are not summable.
P='2025 (prel.)'
SPECS=[
('cassava_production','P214',-1,P,'thousand tonnes (main producing provinces only)',0),
('tea_production','P222',-1,P,'thousand tonnes of fresh bud (main producing provinces only)',0),
('orange_production','P223',-1,P,'thousand tonnes (main producing provinces only)',0),
]
