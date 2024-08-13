"use strict";

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { getFlow, } from "./workflow-parser.js";
import { parseObjectURL, } from "./comfy-utils.js";

async function loadMetadata(filePath) {
  const response = await api.fetchApi(`/shinich39/load-image-with-cmd/load_metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json", },
    body: JSON.stringify({ path: filePath }),
  });

  if (response.status !== 200) {
    throw new Error(response.statusText);
  }

  return await response.json();
}

async function saveMetadata(filePath, info) {
  const response = await api.fetchApi(`/shinich39/load-image-with-cmd/save_metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json", },
    body: JSON.stringify({ path: filePath, info }),
  });

  if (response.status !== 200) {
    throw new Error(response.statusText);
  }

  return true;
}

// Add "flow" to pnginfo
// "flow" has only related nodes for generate image.  
// api.addEventListener("executed", async function(e) {
//   const { detail } = e;
//   const nodeId = detail?.node;
//   const imagePaths = detail?.output?.images?.map(e => parseObjectURL(e).filePath);
//   if (!nodeId || !imagePaths || imagePaths.length < 1) {
//     return;
//   }

//   // additional pnginfo
//   for (const p of imagePaths) {
//     try {
//       let { width, height, info, format } = await loadMetadata(p);
//       let prompt = JSON.parse(info.prompt);
//       let workflow = JSON.parse(info.workflow);
//       let flow = getFlow(workflow, parseInt(nodeId));
//       await saveMetadata(p, {
//         prompt,
//         extra_data: {
//           extra_pnginfo: {
//             workflow,
//             flow,
//           }
//         }
//       });
//     } catch(err) {
//       console.error(err);
//     }
//   }
// });