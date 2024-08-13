from .libs import workflow
from .libs.image import LoadImageWithCMD

NODE_CLASS_MAPPINGS = {
  "LoadImageWithCMD": LoadImageWithCMD,
}

NODE_DISPLAY_NAME_MAPPINGS = {
  "LoadImageWithCMD": "Load image with CMD",
}
