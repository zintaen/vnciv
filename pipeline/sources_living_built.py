"""Source of the "living" stream's built-up timeline: GHSL built-up surface, observed epochs 1975–2020."""

GHSL_BUILT = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_S_GLOBE_R2023A/"
              "GHS_BUILT_S_E{e}_GLOBE_R2023A_54009_1000/V1-0/tiles/GHS_BUILT_S_E{e}_GLOBE_R2023A_54009_1000_V1_0_{t}.zip")
EPOCHS = list(range(1975, 2021, 5))  # observed epochs only: R2023A's 2025 and 2030 are model projections
# 1000 km Mollweide tiles (GHSL tiling schema) holding the centre of every Vietnamese land hex
TILES = ["R7_C28", "R7_C29", "R7_C30", "R8_C29", "R8_C30", "R9_C30"]


def tile_file(e, t):
    return f"GHS_BUILT_S_E{e}_GLOBE_R2023A_54009_1000_V1_0_{t}.zip"


SOURCES = [
    dict(id="ghsl_built", title="GHS-BUILT-S R2023A: built-up surface 1975–2020 (1 km, Mollweide)",
         publisher="European Commission, Joint Research Centre (JRC), Global Human Settlement Layer",
         homepage="https://human-settlement.emergency.copernicus.eu/download.php?ds=bu", license="CC BY 4.0",
         description="Built-up surface (m² of buildings per 1 km cell) from Landsat and Sentinel-2, observed epochs "
         "1975–2020 every 5 years, 1000 km tiles " + ", ".join(TILES) + " of the Mollweide (ESRI:54009) grid. "
         "Pesaresi, M. and Politis, P. 2023, GHS-BUILT-S R2023A, JRC, doi:10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA. "
         "The 2025 and 2030 layers of the release are projections and are not used.",
         used_for=["Living map: cities grow with the year"],
         files=[(GHSL_BUILT.format(e=e, t=t), tile_file(e, t)) for e in EPOCHS for t in TILES]),
]
