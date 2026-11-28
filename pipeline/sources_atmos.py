"""Sources of the atmos stream (live weather layer; fetched by the browser, nothing downloaded by the pipeline)."""

SOURCES = [
    dict(id="open-meteo", title="Open-Meteo weather forecast API (current conditions)",
         publisher="Open-Meteo.com", homepage="https://open-meteo.com", license="CC BY 4.0",
         description="Current temperature, precipitation, cloud cover, weather code and 10 m wind for 57 fixed grid "
         "points over Vietnam, fetched by the visitor's browser only when the Live weather layer is switched on "
         "(one batched request, cached 30 minutes). Weather data by Open-Meteo.com.",
         used_for=["Live weather layer"], files=[]),
]
