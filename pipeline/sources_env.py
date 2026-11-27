"""Sources of the environment stream (climate normals, forest change). Both are read as windows over HTTP by
pipeline/build/ext_env.py (the full files are 0.15–1.5 GB), which caches the clipped rasters in data/raw/<id>/ and
records each read in that folder's manifest.json; `files` is empty so `pipeline fetch` does not pull the full files."""

CHELSA_BIO = "https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/bioclim/{var}/1981-2010/CHELSA_{var}_1981-2010_V.2.1.tif"
GFC = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/Hansen_GFC-2025-v1.13_{layer}_{tile}.tif"

SOURCES = [
    dict(id="chelsa", title="CHELSA V2.1 bioclimatic variables, 1981–2010 (30 arc-seconds)",
         publisher="WSL Swiss Federal Research Institute (Karger et al.)",
         homepage="https://www.chelsa-climate.org/datasets/chelsa_bioclim", license="CC0 1.0",
         description="Climate normals averaged over 1981–2010, downscaled from the ERA5 reanalysis with terrain-based "
         "models (Karger, D.N. et al. 2017, Scientific Data 4: 170122; data: Karger et al. 2021, EnviDat, "
         "doi:10.16904/envidat.228.v2.1). BIO1 annual mean temperature, BIO5 max temperature of the warmest month, "
         "BIO6 min temperature of the coldest month and BIO12 annual precipitation, read at 30 arc-seconds (~0.9 km) "
         "for the map window only.",
         used_for=["Rainfall lens", "Temperature lenses"], files=[]),
    dict(id="hansen_gfc", title="Global Forest Change 2000–2025 v1.13", publisher="Hansen/UMD/Google/USGS/NASA "
         "(GLAD lab, University of Maryland)", homepage="https://glad.earthengine.app/view/global-forest-change",
         license="CC BY 4.0",
         description="Landsat-based tree canopy cover in 2000 and the year of stand-replacing loss 2001–2025, 1 "
         "arc-second (~30 m) tiles 30N_100E, 20N_100E and 10N_100E, read every 4th pixel (~110 m) over Vietnam's "
         "mainland. Hansen, M.C. et al. 2013, Science 342: 850–853. A relative indicator of trends: the producers "
         "warn that sensors and methods changed over time and that pixel counts are not definitive area estimates.",
         used_for=["Forest loss lens", "Forest loss timeline (forest_loss.json)"], files=[]),
]
