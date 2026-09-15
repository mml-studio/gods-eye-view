# NOTICE — third-party data, assets and models

`LICENSE` (MIT) covers the **source code only**. This file covers everything
else the project ships or fetches. It is referenced from `README.md` and
`DATA_SOURCES.md`, and it is kept out of `LICENSE` so GitHub can detect the
code licence as MIT rather than "Other".

## Data and assets

The datasets bundled under src/data/local_data/, and all data fetched from
third-party providers at runtime, are owned by their respective sources and
are NOT licensed under MIT. They are included/visualized for convenience and
remain subject to their own licenses and terms. Notably:

  - TeleGeography Submarine Cable Map (src/data/local_data/
    telegeography_submarine_cables/): CC BY-NC-SA 3.0 — NonCommercial +
    ShareAlike. NOT for commercial use. If you use this project commercially,
    remove these files or obtain a commercial license from TeleGeography.
  - Datacenters and Dams (OpenStreetMap / Open Infrastructure Map extracts):
    Open Database License (ODbL) 1.0 — attribution + share-alike on the data.
  - NASA FIRMS active-fire snapshot: CC0 / U.S. public domain (citation
    requested).

Live sources (Google Maps, OpenSky, adsb.lol, AISStream, CelesTrak, USGS,
OSM Overpass, City of Austin, GBFS) are fetched at runtime under each
provider's terms; some (e.g. Google Maps, OpenSky) restrict commercial use
and require you to supply your own credentials.

In short: the MIT grant does not extend to any third-party data. See
DATA_SOURCES.md for the full per-source license + attribution summary, and
remove any dataset whose terms don't fit your use.

## Personal data

The French practitioner records drawn by the `medecins-fr` layer come from the
**Annuaire santé** published by the CNAM under Licence Ouverte 2.0. They are
PROFESSIONAL contact details that the code de la santé publique (art. L. 1461-2)
requires to be published for this use — name, speciality, practice address and
RPPS number of a practising professional, never a patient record. This project
redistributes them unmodified and holds no rectification channel of its own: a
practitioner who wants an entry corrected or withdrawn must go to the CNAM,
which is the controller.

## 3D models

The 3D models under public/models/ are also third-party works and are NOT
licensed under MIT. They remain under their individual licenses. See
public/models/README.md for the author, source, license, modification notice,
and attribution covering each model file.
