"use strict";

const SAMPLER_TYPES = [
  "KSampler", 
  "KSamplerAdvanced"
];

/**
 * 
 * @param {object} workflow 
 * @param {object} sampler 
 * @returns 
 */
function getNodeMap(workflow, sampler) {
  let w = JSON.parse(JSON.stringify(workflow)),
      f = [], 
      b = [];

  w = unwind(w);

  searchBackward(w, b, 0, sampler.id);
  searchForward(w, f, 0, sampler.id);

  return [...b.slice(1).reverse(), ...f];
  
  function searchForward(w, acc, i, id) {
    const node = w.nodes.find((n) => n.id === id);
    if (!acc[i]) {
      acc[i] = [node];
    } else {
      acc[i].push(node);
    }

    if (!node.outputs) {
      return;
    }

    for (const output of node.outputs) {
      for (const link of output) {
        const n = link?.targetNode;
        if (n) {
          searchForward(w, acc, i + 1, n.id);
        }
      }
    }
  }

  function searchBackward(w, acc, i, id) {
    const node = w.nodes.find((n) => n.id === id);
    if (!acc[i]) {
      acc[i] = [node];
    } else {
      acc[i].push(node);
    }

    if (!node.inputs) {
      return;
    }

    for (const link of node.inputs) {
      const n = link?.originNode;
      if (n) {
        searchBackward(w, acc, i + 1, n.id);
      }
    }
  }

  function unwind(w) {
    w.links = w.links
      .filter((l) => !!l)
      .map((l) => {
        return {
          id: l.id ?? l[0],
          type: l.type ?? l[5],
          origin_id: l.origin_id ?? l[1],
          origin_slot: l.origin_slot ?? l[2],
          target_id: l.target_id ?? l[3],
          target_slot: l.target_slot ?? l[4],
          originNode: w.nodes.find((e) => e.id === (l.origin_id ?? l[1])),
          originSlot: (l.origin_slot ?? l[2]),
          targetNode: w.nodes.find((e) => e.id === (l.target_id ?? l[3])),
          targetSlot: (l.target_slot ?? l[4]),
        }
      });

    for (const n of w.nodes) {
      n.inputs = n.inputs?.map((i) => {
        return w.links.find((l) => l.id === i.link);
      });

      n.outputs = n.outputs?.map((o) => {
        return o.links?.filter(l => l).map((l) => {
          return w.links.find((_l) => _l.id === l);
        });
      });
    }

    return w;
  }
}

/**
 * 
 * @param {object} workflow 
 * @param {number} nodeId 
 * @returns 
 */
function getFlow(workflow, nodeId) {
  let w = JSON.parse(JSON.stringify(workflow)),
      f = [], 
      b = [];

  searchBackward(w, b, 0, nodeId);
  searchForward(w, f, 0, nodeId);

  const nodeMap = [...b.slice(1).reverse(), ...f];
  const nodeIds = [];
  const nodes = [];
  const linkIds = [];
  const links = [];

  for (const m of nodeMap) {
    for (const n of m) {
      if (nodeIds.indexOf(n.id) === -1) {
        nodeIds.push(n.id);
        nodes.push(n);
      }
    }
  }

  nodes.sort((a, b) => a.id - b.id);

  for (const l of w.links) {
    const linkId = l[0];
    const originId = l[1];
    const targetId = l[3];
    if (nodeIds.indexOf(originId) > -1 && nodeIds.indexOf(targetId) > -1) {
      if (linkIds.indexOf(linkId) === -1) {
        linkIds.push(linkId);
        links.push(l);
      }
    }
  }

  links.sort((a, b) => a[0] - b[0]);

  w.nodes = nodes;
  w.links = links;
  w.last_link_id = nodes[nodes.length - 1].id;
  w.last_link_id = links[links.length - 1][0];

  return w;
  
  function searchForward(w, acc, i, id) {
    const node = w.nodes.find((n) => n.id === id);
    if (!acc[i]) {
      acc[i] = [node];
    } else {
      acc[i].push(node);
    }

    const links = w.links.filter(e => e && e[1] === node.id);
    for (const link of links) {
      const targetId = link[3];
      searchForward(w, acc, i + 1, targetId);
    }
  }

  function searchBackward(w, acc, i, id) {
    const node = w.nodes.find((n) => n.id === id);
    if (!acc[i]) {
      acc[i] = [node];
    } else {
      acc[i].push(node);
    }

    const links = w.links.filter(e => e && e[3] === node.id);
    for (const link of links) {
      const originId = link[1];
      searchBackward(w, acc, i + 1, originId);
    }
  }
}

/**
 * 
 * @param {object} workflow 
 * @returns {{id: string, type: string, title: string|null }[]}
 */
function getSamplerNodes(workflow) {
  return workflow.nodes.filter(e => SAMPLER_TYPES.indexOf(e.type) > -1)
    .map(e => e)
    .sort((a, b) => a.id - b.id);
}

export { getSamplerNodes, getNodeMap, getFlow, }