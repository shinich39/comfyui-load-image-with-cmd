"use strict";

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { getSamplerNodes, getNodeMap } from "./workflow-parser.js";
import { initMaskEditor } from "./mask-editor.js";
import * as util from "./util.min.js";
import {
  getImageURL,
  renderCanvas,
  selectNode,
  parseURL,
  parseObjectURL,
  getPathFromURL,
  getRandomSeed,
} from "./comfy-utils.js";

const NODE_TYPE = "LoadImageWithCMD";
const DEFAULT_NODE_COLORS = LGraphCanvas.node_colors;
const DEFAULT_MARGIN_X = 30;
const DEFAULT_MARGIN_Y = 60;

function initLoadImageNode() {
  try {
    const self = this;

    this.statics = {
      isInitialized: false,
      countQueues: 0,
      countLoops: 0,
      countErrors: 0,
      loadedImages: [],
      selectedImage: null,
      selectedIndex: -1,
      state: {},
    };

    this.statics.init = (function() {
      const self = this;
      if (this.widgets) {
        this.statics.DIR_PATH = this.widgets.find(e => e.name === "dir_path");
        this.statics.INDEX = this.widgets.find(e => e.name === "index");
        this.statics.MODE = this.widgets.find(e => e.name === "mode");
        this.statics.FILENAME = this.widgets.find(e => e.name === "filename");
        this.statics.COMMAND = this.widgets.find(e => e.name === "command");

        if (!this.statics.MASK) {
          this.statics.MASK = initMaskEditor.apply(this);

          // add mask control widget
          const clearWidget = this.addWidget("button", "Clear", null, () => {}, {
            serialize: false,
          });

          clearWidget.computeSize = () => [0, 26];
          clearWidget.serializeValue = () => undefined;
          clearWidget.callback = function() {
            self.statics.MASK.clearEvent();
          }
        }

        if (!this.statics.DIR_PATH) {
          throw new Error("dir_path widget not found.");
        }
        if (!this.statics.INDEX) {
          throw new Error("index widget not found.");
        }
        if (!this.statics.MODE) {
          throw new Error("index widget not found.");
        }
        if (!this.statics.FILENAME) {
          throw new Error("filename widget not found.");
        }
        if (!this.statics.COMMAND) {
          throw new Error("command widget not found.");
        }
        if (!this.statics.MASK) {
          throw new Error("maskeditor widget not found.");
        }

        this.statics.isInitialized = true;
      } else {
        throw new Error("widgets not found.");
      }
    }).bind(this);

    this.statics.getIndex = (function(idx) {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }
        let i = typeof idx === "number" ? idx : this.statics.INDEX.value;
        const min = 0;
        const max = this.statics.loadedImages?.length || 0;
        if (i < min) {
          i = max + i;
        } else if (max && i >= max) {
          i = i % max;
        }
        return i;
      } catch(err) {
        console.error(err);
        return 0;
      }
    }).bind(this);

    this.statics.loadImageByPath = (async function(filePath) {
      if (!this.statics.isInitialized) {
        throw new Error(`node #${this.id} has not been initialized.`);
      }
      if (!filePath || filePath.trim() == "") {
        return;
      }

      filePath = filePath.replace(/[\\\/]+/g, "/");
      let dirPath = filePath.replace(/\/[^\/]+$/, "/");
      let basename = filePath.replace(dirPath, "");
      let filename = basename.replace(/.[^.]+$/, "");

      if (this.statics.DIR_PATH.value === dirPath && this.statics.FILENAME.value === filename) {
        throw new Error(`Image already loaded: ${dirPath}/${filename}`);
      }

      this.statics.resetCounter();
      await this.statics.updateDirPath(dirPath);
      await this.statics.loadImages();

      let idx = this.statics.loadedImages.findIndex(e => {
        return e.origName === filename;
      });

      if (idx === -1) {
        idx = 0;
      }

      this.statics.updateIndex(idx);
      this.statics.clearWorkflow();
      this.statics.clearImage();
      this.statics.selectImage();
      this.statics.renderImage();
      await this.statics.renderWorkflow("changeIndex");
      selectNode(this);
    }).bind(this);

    this.statics.clearImage = (async function() {
      if (!this.statics.isInitialized) {
        throw new Error(`node #${this.id} has not been initialized.`);
      }
      const w = this.statics.MASK;
      w.element.style.width = this.size[0] - 32;
      w.element.style.height = this.size[0] - 32;
      w.origImgLoaded = false;
      w.drawImgLoaded = false;
      w.maskImgLoaded = false;
      w.origCtx.clearRect(0,0,w.origCanvas.width,w.origCanvas.height);
      w.drawCtx.clearRect(0,0,w.drawCanvas.width,w.drawCanvas.height);
      w.maskCtx.clearRect(0,0,w.maskCanvas.width,w.maskCanvas.height);
      w.origImg.src = "";
      w.drawImg.src = "";
      w.maskImg.src = "";
    }).bind(this);

    this.statics.selectImage = (async function() {
      if (!this.statics.isInitialized) {
        throw new Error(`node #${this.id} has not been initialized.`);
      }
      let i = this.statics.getIndex();
      this.statics.selectedIndex = i;
      this.statics.selectedImage = this.statics.loadedImages[i];
      if (!this.statics.selectedImage) {
        this.statics.FILENAME.prevValue = "NO IMAGE";
        this.statics.FILENAME.value = "NO IMAGE";
        throw new Error(`No image in ${this.statics.DIR_PATH.value}`);
      }
      this.statics.FILENAME.prevValue = this.statics.selectedImage.origName;
      this.statics.FILENAME.value = this.statics.selectedImage.origName;
    }).bind(this);

    this.statics.renderImage = (async function() {
      if (!this.statics.isInitialized) {
        throw new Error(`node #${this.id} has not been initialized.`);
      }
      if (!this.statics.selectedImage) {
        return;
      }
      try {
        const { origPath, drawPath, maskPath, } = this.statics.selectedImage;
        this.statics.MASK.origImg.src = getImageURL(origPath);
        this.statics.MASK.drawImg.src = drawPath ? getImageURL(drawPath) : "";
        this.statics.MASK.maskImg.src = maskPath ? getImageURL(maskPath) : "";
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.loadImages = (async function() {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }

        // clear loaded images
        this.statics.loadedImages = [];
  
        // get images in directory
        let d = this.statics.DIR_PATH.value;
        if (d && d.trim() !== "") {
          const images = await loadImages(d);
          for (const image of images) {
            try {
              if (!image.info || !image.info.workflow || !image.info.prompt) {
                continue;
              }
              for (const key of Object.keys(image.info)) {
                try {
                  image.info[key] = JSON.parse(image.info[key]);
                } catch(err) {

                }
              }
              this.statics.loadedImages.push({
                origPath: image["original_path"],
                origName: image["original_name"],
                drawPath: image["draw_path"],
                drawName: image["draw_name"],
                maskPath: image["mask_path"],
                maskName: image["mask_name"],
                width: image.width,
                height: image.height,
                format: image.format,
                info: image.info,
              });
            } catch(err) {
              // console.error(err);
            }
          }
        }
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.updateDirPath = (function(str) {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }
        this.statics.DIR_PATH.isCallbackEnabled = false; // prevent callback
        this.statics.DIR_PATH.prevValue = str;
        this.statics.DIR_PATH.value = str;
        this.statics.DIR_PATH.isCallbackEnabled = true;
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.updateIndex = (function(idx) {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }
        this.statics.INDEX.isCallbackEnabled = false; // prevent callback

        let isFixed = typeof idx === "number";
        let images = this.statics.loadedImages;
        let m = this.statics.MODE.value;

        if (!isFixed) {
          idx = this.statics.getIndex();
          if (m === "increment") {
            idx += 1;
          } else if (m === "decrement") {
            idx -= 1;
          } else if (m === "randomize") {
            idx = Math.floor(util.random(0, images.length));
          }
        }

        let clampedIdx = this.statics.getIndex(idx);

        this.statics.INDEX.value = Math.round(clampedIdx);

        // increase counts
        if (!isFixed) {
          this.statics.countQueues += 1;
          if (m === "increment" && clampedIdx < idx) {
            this.statics.countLoops += 1;
          } else if (m === "decrement" && clampedIdx > idx) {
            this.statics.countLoops += 1;
          }
        }

        this.statics.INDEX.isCallbackEnabled = true;
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.resetCounter = (function() {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }

        // reset
        this.statics.countQueues = 0;
        this.statics.countLoops = 0;
        this.statics.countErrors = 0;
        this.statics.state = {};
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.getCommand = (function() {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }
        if (!app.graph.links || !this.inputs) {
          return;
        }

        const input = this.inputs.find(e => e.name === "command");
        if (!input || !input.link) {
          return;
        }

        const link = app.graph.links.find(e => e && e.id === input.link);
        const originNode = app.graph._nodes.find(e => e.id === link.origin_id);
        const originSlot = link.origin_slot;
        const targetNode = this;
        const targetSlot = link.target_slot;
        const w = originNode.widgets?.[0];
        if (w) {
          const v = w.value;
          if (v && v.trim() !== "") {
            return v;
          }
        }
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.setCommand = (function(v) {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }
        if (!app.graph.links || !this.inputs) {
          return;
        }

        const input = this.inputs.find(e => e.name === "command");
        if (!input || !input.link) {
          return;
        }

        const link = app.graph.links.find(e => e && e.id === input.link);
        const originNode = app.graph._nodes.find(e => e.id === link.origin_id);
        const originSlot = link.origin_slot;
        const targetNode = this;
        const targetSlot = link.target_slot;

        const w = originNode.widgets?.[0];
        if (w) {
          w.value = v;
        }
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    this.statics.clearWorkflow = (function() {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }
        const nodes = [];
        for (const n of app.graph._nodes) {
          if (n && n.properties && n.properties.parentId == this.id) {
            nodes.push(n);
          }
        }

        if (nodes.length > 0) {
          app.canvas.selectNodes(nodes);
          app.canvas.deleteSelectedNodes();
        }

        renderCanvas();
      } catch(err) {
        console.error(err);
      }
    }).bind(this);
  
    this.statics.renderWorkflow = (async function(type) {
      try {
        if (!this.statics.isInitialized) {
          throw new Error(`node #${this.id} has not been initialized.`);
        }

        const COMMAND = this.statics.getCommand();
        if (!COMMAND) {
          return;
        }
    
        let { selectedImage, selectedIndex } = this.statics;
        let { width, height, info } = selectedImage;
        let { workflow, prompt, flow } = info;

        if (typeof flow === "object") {
          workflow = flow;
        }
        if (typeof workflow !== "object") {
          return;
        }

        let samplerNodes = getSamplerNodes(workflow);

        // remove command nodes in workflow
        removeNodesFromWorkflow(workflow);
    
        // create virtual graph and virtual canvas
        // this methods call node.onConnectionsChange
        let graph = new LGraph(workflow);
        let canvas = new LGraphCanvas(null, graph, { skip_events: true, skip_render: true });
    
        // parse workflow
        samplerNodes = samplerNodes.map(sampler => {
          const nodeMap = getNodeMap(workflow, sampler);
          const samplers = nodeMap.reduce((acc, cur) => {
            for (const {id, type} of cur) {
              if (type === "KSampler" || type === "KSamplerAdvanced") {
                const node = graph._nodes.find(e => e.id === id);
                if (node) {
                  acc.push(node);
                }
              }
            }
            return acc;
          }, []);
    
          return {
            samplers: samplers,
            nodeMap: nodeMap,
          }
        });
    
        // put the map in long order
        samplerNodes.sort((a, b) => b.nodeMap.length - a.nodeMap.length);
    
        const samplerMaps = samplerNodes.map(e => e.samplers);
        const nodeMaps = samplerNodes.map(e => e.nodeMap);
    
        // select longest flow
        const samplers = samplerMaps[0];
        const nodeMap = nodeMaps[0];
        
        // node.statics.selectedGraph = graph;
        // node.statics.selectedCanvas = canvas;
    
        // set properties
        for (const n of graph._nodes) {
          // set statics properties
          n.properties.parentId = this.id;
          n.properties.originalId = n.id;
    
          // set color to yellow
          if (DEFAULT_NODE_COLORS) {
            n.color = DEFAULT_NODE_COLORS.yellow.color;
            n.bgcolor = DEFAULT_NODE_COLORS.yellow.bgcolor;
            n.groupcolor = DEFAULT_NODE_COLORS.yellow.groupcolor;
          }
    
          // disable pin
          if (n.flags) {
            n.flags.pinned = false;
          }
    
          // lock => Symbol()?
        }
    
        // align nodes
        // graph.arrange(DEFAULT_MARGIN_X);
        // graph.arrange(DEFAULT_MARGIN_Y, LiteGraph.VERTICAL_LAYOUT);
    
        ;(() => {
          try {
            // global variables
            const BOUNDING_X = this.pos[0];
            const BOUNDING_Y = this.pos[1];
            const BOUNDING_W = this.size[0];
            const BOUNDING_H = this.size[1];
            const SEED = getRandomSeed();
    
            const DIR_PATH = selectedImage.dirPath;
            const INDEX = selectedIndex;
            const FILENAME = selectedImage.origName;
            const FILE_PATH = selectedImage.origPath;
            const WIDTH = width;
            const HEIGHT = height;
    
            const DATE = new Date();
            const YEAR = DATE.getFullYear();
            const MONTH = DATE.getMonth() + 1;
            const DAY = DATE.getDay();
            const HOURS = DATE.getHours();
            const MINUTES = DATE.getMinutes();
            const SECONDS = DATE.getSeconds();
    
            const SAMPLERS = samplers;
            const SAMPLER = samplers[samplers.length - 1];
    
            const STATE = this.statics.state;
            const countImages = this.statics.loadedImages.length;
            const countQueues = this.statics.countQueues;
            const countLoops = this.statics.countLoops;
            const countErrors = this.statics.countErrors;
     
            // global methods
            const stop = () => unsetAutoQueue();
            const find = (query, isActual) => getNodeFromWorkflows(query, isActual, false);
            const findLast = (query, isActual) => getNodeFromWorkflows(query, isActual, true);
            const connect = (a, b, name) => connectNodes(a, b, name);
            const getValues = (node, isActual) => getWidgetValues(node, isActual);
            const setValues = (node, values, isActual) => setWidgetValues(node, values, isActual);
            const getNodes = (srcNode, dstNode, name, replacements) => loadFromVirtualNode(srcNode, dstNode, name, {
              x: BOUNDING_X + BOUNDING_W + DEFAULT_MARGIN_X,
              y: BOUNDING_Y,
              replacements,
            });
    
            // alias
            const W = width;
            const H = height;
            const S = SAMPLER;
            const getNode = getNodes;
            const getValue = getValues;
            const setValue = setValues;
    
            // the methods available after "executed"
            const setDirPath = async (dirPath) => await changeDirPath.apply(this, [dirPath]);
            const setIndex = async (index) => await changeIndex.apply(this, [index]);
            const loadByFilePath = async (filePath) => await loadImageByPath.apply(this, [filePath]);
            const loadByNode = async (node) => await loadImageByNode.apply(this, [node]);
    
            // callbacks
            let onError = (err) => { console.error(err); };
    
            // execute
            eval(`
              try {
                ${COMMAND}
              } catch(err) {
                onError(err);
              }
            `.trim());
          } catch(err) {
            console.error(err);
          }
          
          renderCanvas();
        })();
    
        function connectNodes(a, b, name) {
          a = getActualNode(a);
          b = getActualNode(b);
    
          let output = a.outputs?.find(e => e.name === name); // uppercase
          let outputSlot;
          let input = b.inputs?.find(e => e.name === name);
          let inputSlot;
    
          if (output) {
            outputSlot = a.findOutputSlot(output.name);
            input = b.inputs?.find(e => e.type === output.type && !e.link);
            if (input) {
              inputSlot = b.findInputSlot(input.name);
            }
          } else if (input) {
            inputSlot = b.findInputSlot(input.name);
            output = a.outputs?.find(e => e.type === input.type);
            if (output) {
              outputSlot = a.findOutputSlot(output.name);
            }
          }
    
          if (typeof inputSlot === "number" && typeof outputSlot === "number") {
            a.connect(outputSlot, b.id, inputSlot);
          }
        }
    
        function loadFromVirtualNode(src, dst, name, options) {
          src = getVirtualNode(src, true);
          dst = getActualNode(dst);
          if (!src) {
            throw new Error("Source node not found.");
          }
          if (!dst) {
            throw new Error("Destination node not found.");
          }
          if (src.type !== dst.type) {
            throw new Error(`${src.type} does not match with ${dst.type}`);
          }
    
          let newNodes = [];
          let isInput = false;
          let originNode;
          let originSlot;
    
          if (src.inputs) {
            const input = src.inputs.find(e => e.name === name);
            if (input) {
              isInput = true;
    
              const link = getInputLink(src, name);
              const n = link.originNode;
              const nodes = [n, ...getChildNodes(n)];
              newNodes = createNodes(nodes, options);
              if (newNodes.length > 0) {
                originNode = newNodes[0];
                if (link.originName) {
                  originSlot = originNode.findOutputSlot(link.originName);
                } else {
                  originSlot = originNode.findOutputSlotByType(link.type);
                }
              }
            }
          }
    
          if (isInput) {
            if (originNode) {
              // find input
              if (dst.inputs) {
                const input = dst.inputs.find(e => e.name === name);
    
                // widget to input
                if (!input) {
                  const widget = dst.widgets?.find(e => e.name === name);
                  if (widget) {
                    dst.convertWidgetToInput(widget);
                  }
                }
              }
    
              const targetId = dst.id;
              const targetSlot = dst.findInputSlot(name);
              originNode.connect(originSlot, targetId, targetSlot);
            }
          } else {
            let value;
            if (src.widgets) {
              const widget = src.widgets.find(e => e.name === name);
              if (widget) {
                value = widget.value;
              }
            }
            if (dst.widgets) {
              const input = dst.inputs?.find(e => e.name === name);
              const widget = dst.widgets.find(e => e.name === name);
              if (widget) {
                if (input) {
                  convertInputToWidget(dst, widget);
                }
                widget.value = value;
              }
            }
          }
    
          return newNodes.reverse();
        }
    
        function getNodeFromWorkflows(query, isActual = false, reverse = false) {
          return typeof query === "number" || isActual ?
            getActualNode(query) : 
            getVirtualNode(query, reverse);
        }
    
        function getVirtualNode(any, reverse) {
          if (typeof any === "object") {
            return any;
          }
          if (!reverse) {
            for (let i = 0; i < nodeMap.length; i++) {
              const nodes = nodeMap[i];
              for (const n of nodes) {
                const node = graph._nodes.find(e => e.id === n.id);
                if (!node) {
                  continue;
                }
                if (matchNode(node, any)) {
                  return node;
                }
              }
            }
          } else {
            for (let i = nodeMap.length - 1; i >= 0; i--) {
              const nodes = nodeMap[i];
              for (const n of nodes) {
                const node = graph._nodes.find(e => e.id === n.id);
                if (!node) {
                  continue;
                }
                if (matchNode(node, any)) {
                  return node;
                }
              }
            }
          }
        }
    
        function getActualNode(any) {
          if (typeof any === "number") {
            return app.graph._nodes.find(e => isNodeId(e, any));
          } else if (typeof any === "string") {
            return app.graph._nodes.find(e => matchNode(e, any));
          } else if (typeof any === "object") {
            return any;
          }
        }
    
        async function changeIndex(n) {
          if (["executed"].indexOf(type) === -1) {
            console.error(`next() has been blocked by type: ${type}`);
            return;
          }
          this.statics.resetCounter();
          this.statics.updateIndex(n);
          this.statics.clearWorkflow();
          this.statics.clearImage();
          this.statics.selectImage();
          this.statics.renderImage();
          await this.statics.renderWorkflow("changeIndex");
          selectNode(this);
        }
    
        async function changeDirPath(dirPath) {
          if (["executed"].indexOf(type) === -1) {
            console.error(`loadDir() has been blocked by type: ${type}`);
            return;
          }
          this.statics.resetCounter();
          await this.statics.updateDirPath(dirPath);
          await this.statics.loadImages();
          this.statics.updateIndex(0);
          this.statics.clearWorkflow();
          this.statics.clearImage();
          this.statics.selectImage();
          this.statics.renderImage();
          await this.statics.renderWorkflow("changeDirPath");
          selectNode(this);
        }
    
        async function loadImageByPath(filePath) {
          if (["executed"].indexOf(type) === -1) {
            console.error(`loadFile() has been blocked by type: ${type}`);
            return;
          }
          if (filePath && this.statics.loadedImagePath !== filePath) {
            this.statics.loadedImagePath = filePath;
            await this.statics.loadImageByPath(filePath);
          }
        }
    
        async function loadImageByNode(node, index = 0) {
          if (["executed"].indexOf(type) === -1) {
            console.error(`loadImage() has been blocked by type: ${type}`);
            return;
          }
          node = getActualNode(node);
          if (node && Array.isArray(node.imagePaths) && node.imagePaths[index]) {
            const imagePath = node.imagePaths[index];
            await this.statics.loadImageByPath(imagePath);
          }
        }
    
        function matchNode(node, query) {
          if (typeof query === "number") {
            return isNodeId(node, query);
          } else if (typeof query === "string") {
            return isNodeType(node, query.toLowerCase());
          } else {  
            return false;
          }
        }
    
        function isNodeId(node, id) {
          return node.id === id;
        }
    
        function isNodeType(node, name) {
          return (node.title && node.title.toLowerCase() === name) || 
            (node.comfyClass && node.comfyClass.replace(/\s/g, "").toLowerCase() === name) ||
            (node.type && node.type.replace(/\s/g, "").toLowerCase() === name);
        }
    
        function getWidgetValues(node, isActual) {
          node = getNodeFromWorkflows(node, isActual, false);
          let result = {};
          if (node.widgets) {
            for (const widget of node.widgets) {
              result[widget.name] = widget.value;
            }
          }
          return result;
        }
    
        function setWidgetValues(node, values, isActual) {
          node = getNodeFromWorkflows(node, isActual, false);
          if (node.widgets) {
            for (const [key, value] of Object.entries(values)) {
              const widget = node.widgets.find(e => e.name === key);
              if (widget) {
                widget.value = value;
              }
            }
          }
        }
    
        function getInputNodes(node) {
          let result = {};
          if (node.inputs) {
            for (const input of node.inputs) {
              const link = getInputLink(node, input.name);
              const n = link.originNode;
              result[input.name] = [n, ...getChildNodes(n)];
            }
          }
          return result;
        }
    
        function createNodes(nodes, options = {}) {
          let x = options.x ?? 0;
          let y = options.y ?? 0;
          let replaceNodes = options.replacements ?? [];
    
          if (!Array.isArray(replaceNodes)) {
            replaceNodes = [replaceNodes];
          }
    
          // replacements to nodes
          replaceNodes = replaceNodes
            .map(getActualNode)
            .filter(e => !!e)
            .map(e => {
              return {
                isReplaced: false,
                id: e.id,
                type: e.type,
                node: e,
                inputs: [],
                outputs: [],
              }
            });
    
          let filteredNodes = [];
          for (const node of nodes) {
            const rep = replaceNodes.find(e => !e.isReplaced && e.type === node.type);
            if (!rep) {
              filteredNodes.push(node);
              continue;
            }
            const { inputs, outputs } = rep;
            rep.isReplaced = true;
    
            if (node.inputs) {
              for (const input of node.inputs) {
                if (!input.link) {
                  continue;
                }
    
                const link = graph.links.find(e => e && e.id === input.link);
                if (!link) {
                  continue;
                }
    
                const originId = link.origin_id;
                const originSlot = link.origin_slot;
                const targetId = rep.id;
                const targetSlot = link.target_slot;
    
                inputs.push([originId,originSlot,targetId,targetSlot]);
              }
            }
    
            if (node.outputs) {
              for (const output of node.outputs) {
                if (!output.links) {
                  continue;
                }
                for (const linkId of output.links) {
                  if (!linkId) {
                    continue;
                  }
    
                  const link = graph.links.find(e => e && e.id === linkId);
                  if (!link) {
                    continue;
                  }
    
                  const originId = rep.id;
                  const originSlot = link.origin_slot;
                  const targetId = link.target_id;
                  const targetSlot = link.target_slot;
    
                  outputs.push([originId,originSlot,targetId,targetSlot]);
                }
              }
            }
          }
    
          if (filteredNodes.length < 1) {
            return [];
          }
    
          // copy virtual nodes
          canvas.selectNodes(filteredNodes);
          canvas.copyToClipboard();
    
          // set position
          setCanvasPointer(x, y);
    
          // paste to actual workflow
          app.canvas.pasteFromClipboard();
          app.canvas.deselectAllNodes();
    
          let importedNodes = [];
          for (const node of filteredNodes) {
            const n = app.graph._nodes.find(e => {
              return e && 
                e.properties && 
                e.properties.originalId == node.id &&
                !e.properties.isConnected;
            });
    
            if (n) {
              importedNodes.push(n);
    
              // set properties
              n.properties.isConnected = true;
            }
          }
    
          // re-connect to replacements
          for (const r of replaceNodes) {
            const { node, inputs, outputs } = r;
            
            for (const input of inputs) {
              const originNode = importedNodes.find(e => e.properties.originalId === input[0]);
              const originSlot = input[1];
              const targetId = input[2];
              const targetSlot = input[3];
              if (originNode) {
                originNode.connect(originSlot, targetId, targetSlot);
              }
            }
    
            for (const output of outputs) {
              const originNode = node;
              const originSlot = output[1];
              const targetNode = importedNodes.find(e => e.properties.originalId === output[2]);
              const targetSlot = output[3];
              if (targetNode) {
                const targetId = targetNode.id;
                originNode.connect(originSlot, targetId, targetSlot);
              }
            }
          }
    
          // check exists nodes
          importedNodes = replaceExistsNodes(importedNodes);
    
          // align to bottom
          for (const node of importedNodes) {
            moveToBottom(node);
          }
    
          return importedNodes;
        }
    
        function convertInputToWidget(node, widget) {
          showWidget(widget);
          const sz = node.size;
          node.removeInput(node.inputs.findIndex((i) => i.widget?.name === widget.name));
        
          for (const widget of node.widgets) {
            widget.last_y -= LiteGraph.NODE_SLOT_HEIGHT;
          }
        
          // Restore original size but grow if needed
          node.setSize([Math.max(sz[0], node.size[0]), Math.max(sz[1], node.size[1])]);
    
          function showWidget(widget) {
            widget.type = widget.origType;
            widget.computeSize = widget.origComputeSize;
            widget.serializeValue = widget.origSerializeValue;
          
            delete widget.origType;
            delete widget.origComputeSize;
            delete widget.origSerializeValue;
          
            // Hide any linked widgets, e.g. seed+seedControl
            if (widget.linkedWidgets) {
              for (const w of widget.linkedWidgets) {
                showWidget(w);
              }
            }
          }
        }
    
        function getInputLink(node, inputName) {
          const input = node.inputs?.find(e => e.name.toLowerCase() === inputName.toLowerCase());
          if (!input || !input.link) {
            return;
          }
    
          const inputSlot = node.findInputSlot(input.name);
          const links = graph.links.filter(e => e);
          const link = links.find(e => e.target_id === node.id && e.target_slot === inputSlot);
          if (!link) {
            return;
          }
    
          const originNode = graph._nodes.find(e => e.id === link.origin_id);
          if (!originNode) {
            return;
          }
    
          const originSlot = link.origin_slot;
          const originOutput = originNode?.outputs?.[originSlot];
          const originName = originOutput?.name;
    
          return {
            type: link.type,
            originNode,
            originSlot,
            originName,
            targetNode: node,
            targetSlot: inputSlot,
            targetName: input.name,
          }
        }
    
        function putOnRight(anchorNode, targetNode) {
          targetNode.pos[0] = anchorNode.pos[0] + anchorNode.size[0] + DEFAULT_MARGIN_X;
          targetNode.pos[1] = anchorNode.pos[1];
        }
    
        function putOnBottom(anchorNode, targetNode) {
          targetNode.pos[0] = anchorNode.pos[0];
          targetNode.pos[1] = anchorNode.pos[1] + anchorNode.size[1] + DEFAULT_MARGIN_Y;
        }
    
        function moveToRight(targetNode) {
          let isChanged = true;
          while(isChanged) {
            isChanged = false;
            for (const node of app.graph._nodes) {
              if (node.id === targetNode.id) {
                continue;
              }
              const top = node.pos[1];
              const bottom = node.pos[1] + node.size[1];
              const left = node.pos[0];
              const right = node.pos[0] + node.size[0];
              const isCollisionX = left <= node.pos[0] + targetNode.size[0] && 
                right >= targetNode.pos[0];
              const isCollisionY = top <= node.pos[1] + targetNode.size[1] && 
                bottom >= targetNode.pos[1];
    
              if (isCollisionX && isCollisionY) {
                targetNode.pos[0] = right + DEFAULT_MARGIN_X;
                isChanged = true;
              }
            }
          }
        }
    
        function moveToBottom(targetNode) {
          let isChanged = true;
          while(isChanged) {
            isChanged = false;
            for (const node of app.graph._nodes) {
              if (node.id === targetNode.id) {
                continue;
              }
              const top = node.pos[1];
              const bottom = node.pos[1] + node.size[1];
              const left = node.pos[0];
              const right = node.pos[0] + node.size[0];
              const isCollisionX = left <= targetNode.pos[0] + targetNode.size[0] && 
                right >= targetNode.pos[0];
              const isCollisionY = top <= targetNode.pos[1] + targetNode.size[1] && 
                bottom >= targetNode.pos[1];
    
              if (isCollisionX && isCollisionY) {
                targetNode.pos[1] = bottom + DEFAULT_MARGIN_Y;
                isChanged = true;
              }
            }
          }
        }
    
        function getChildNodes(node) {
          let nodeIds = [];
          let queue = [node.id];
          let links = graph.links.filter(e => e);
          while(queue.length > 0) {
            const nodeId = queue.shift();
            for (const l of links) {
              if (l.target_id === nodeId) {
                if (nodeIds.indexOf(l.origin_id) === -1) {
                  nodeIds.push(l.origin_id);
                }
                if (queue.indexOf(l.origin_id) === -1) {
                  queue.push(l.origin_id);
                }
              }
            }
          }
          
          let nodes = [];
          for (const id of nodeIds) {
            const n = graph._nodes.find(e => e.id === id);
            if (n) {
              nodes.push(n);
            }
          }
    
          return nodes;
        }
    
        function setCanvasPointer(x, y) {
          app.canvas.graph_mouse[0] = x;
          app.canvas.graph_mouse[1] = y;
        }
    
        function replaceExistsNodes(nodes) {
          if (!app.graph.links) {
            return nodes;
          }
    
          const _nodes = [];
          for (const node of nodes) {
            const origId = node.properties.originalId;
            const exists = app.graph._nodes.find(e => e.id !== node.id && e.properties.originalId === origId);
            if (!exists) {
              _nodes.push(node);
              continue;
            }
    
            const srcId = node.id;
            const dstId = exists.id;
    
            // change links from new node
            for (const link of app.graph.links) {
              if (!link) {
                continue;
              }
    
              const originId = link.origin_id;
              const originSlot = link.origin_slot;
              const targetId = link.target_id;
              const targetSlot = link.target_slot;
    
              if (link.origin_id === srcId) {
                app.graph.removeLink(link.id);
                exists.connect(originSlot, targetId, targetSlot);
              }
    
              if (link.target_id === srcId) {
                app.graph.removeLink(link.id);
                const originNode = app.graph._nodes.find(e => e.id === originId);
                originNode.connect(originSlot, dstId, targetSlot);
              }
            }
            
            // remove new node
            app.graph.remove(node);
    
            _nodes.push(exists);
          }
    
          return _nodes;
        }
    
        function removeNodesFromWorkflow(workflow) {
          let removedLinks = [];
          let nodeIds = [];
          for (let i = workflow.nodes.length - 1; i >= 0; i--) {
            const node = workflow.nodes[i];
    
            // remove nodes
            if (node.type === NODE_TYPE) {
              // command does not have input and outputs
              workflow.nodes.splice(i, 1);
              nodeIds.push(node.id);
            }
          }
    
          let linkIds = [];
          for (let i = workflow.links.length - 1; i >= 0; i--) {
            if (!workflow.links[i]) {
              continue;
            }
            const l = workflow.links[i];
            const link = {
              id: l[0],
              type: l[5],
              origin_id: l[1],
              origin_slot: l[2],
              target_id: l[3],
              target_slot: l[4],
            }
            // remove links
            if (nodeIds.indexOf(link.target_id) > -1) {
              workflow.links.splice(i, 1);
              linkIds.push(link.id);
              removedLinks.push(link); 
            }
          }
    
          for (const node of workflow.nodes) {
            // remove input link
            if (node.inputs) {
              for (const input of node.inputs) {
                if (!input.link) {
                  continue;
                }
                if (linkIds.indexOf(input.link) > -1) {
                  input.link = null
                }
              }
            }
    
            // remove output links
            if (node.outputs) {
              for (const output of node.outputs) {
                if (output.links) {
                  for (let i = output.links.length - 1; i >= 0; i--) {
                    const linkId = output.links[i];
                    if (linkIds.indexOf(linkId) > -1) {
                      output.links.splice(i, 1);
                    }
                  }
                }
              }
            }
          }
    
          return removedLinks;
        }
      } catch(err) {
        console.error(err);
      }
    }).bind(this);

    // create widgets
    this.statics.init();

    const dpWidget = this.statics.DIR_PATH;
    const idxWidget = this.statics.INDEX;
    const fnWidget = this.statics.FILENAME;
    const modeWidget = this.statics.MODE;
    const maskWidget = this.statics.MASK;
    const cmdWidget = this.statics.COMMAND;

    // this.onSelected = (e) => this.setDirtyCanvas(true, true);
    const onKeyDown = this.onKeyDown;
    this.onKeyDown = async function(e) {
      const r = onKeyDown.apply(this, arguments);
      const { key, ctrlKey, metaKey, shiftKey } = e;
      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        this.statics.resetCounter();
        if (key === "ArrowLeft") {
          this.statics.updateIndex(this.statics.INDEX.value - 1);
        } else {
          this.statics.updateIndex(this.statics.INDEX.value + 1);
        }
        this.statics.clearWorkflow();
        this.statics.clearImage();
        this.statics.selectImage();
        this.statics.renderImage();
        await this.statics.renderWorkflow("changeIndex");
        selectNode(this);
      } else if ((key === "r" && (ctrlKey || metaKey)) || key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        this.statics.resetCounter();
        await this.statics.loadImages();
        this.statics.updateIndex(this.statics.getIndex());
        this.statics.clearWorkflow();
        this.statics.clearImage();
        this.statics.selectImage();
        this.statics.renderImage();
        await this.statics.renderWorkflow("refresh");
        selectNode(this);
      }
      return r;
    };

    const onConnectInput = this.onConnectInput;
    this.onConnectInput = function(targetSlot, type, targetInput, originNode, originSlot) {
      const r = onConnectInput?.apply(this, arguments);

      if (originNode.type !== "PrimitiveNode") {
        alert("Command input only connect to the primitive node.");
        return false;
      }

      if (this.statics.COMMAND.value.trim() === "") {
        this.statics.COMMAND.isCallbackEnabled = false;
        this.statics.COMMAND.value = getDefaultCommandValue();
        this.statics.COMMAND.isCallbackEnabled = true;
      }

      return r;
    };

    const onConnectionsChange = this.onConnectionsChange;
    this.onConnectionsChange = async function(type, _, connected, link_info) {
      const r = onConnectionsChange?.apply(this, arguments);
      if (link_info && link_info.target_slot === 0) {
        this.statics.clearWorkflow();
        if (connected) {
          await this.statics.renderWorkflow("changeConnection");
        }
      }
      return r;
    }

    cmdWidget.timer = null;
    cmdWidget.isCallbackEnabled = false;
    cmdWidget.callback = function(v) {
      if (app.configuringGraph || !this.isCallbackEnabled) {
        return;
      }
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.timer = setTimeout(async () => {
        if (self.statics.COMMAND.value.trim() === "") {
          this.isCallbackEnabled = false;
          self.statics.COMMAND.value = getDefaultCommandValue();
          self.statics.setCommand(self.statics.COMMAND.value);
          this.isCallbackEnabled = true;
        }
        self.statics.clearWorkflow();
        await self.statics.renderWorkflow("changeCommand");
      }, 512);
    }

    dpWidget.isCallbackEnabled = false;
    dpWidget.options.getMinHeight = () => 64;
    dpWidget.options.getMaxHeight = () => 64;
    dpWidget.callback = async function(currValue) {
      if (!this.isCallbackEnabled) {
        return;
      }
      if (this.prevValue !== currValue) {
        this.prevValue = currValue;
        self.statics.resetCounter();
        await self.statics.loadImages();
        self.statics.updateIndex(0);
        self.statics.clearWorkflow();
        self.statics.clearImage();
        self.statics.selectImage();
        self.statics.renderImage();
        await self.statics.renderWorkflow("changeDirPath");
        selectNode(self);
      }
    }

    fnWidget.callback = function(currValue) {
      if (this.prevValue !== currValue) {
        this.value = this.prevValue;
        alert("You can not change filename.");
      }
    }

    idxWidget.isCallbackEnabled = false;
    idxWidget.timer = null;
    idxWidget.callback = function(v) {
      if (!this.isCallbackEnabled) {
        return;
      }
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(async () => {
        self.statics.resetCounter();
        self.statics.updateIndex(self.statics.getIndex());
        self.statics.clearWorkflow();
        self.statics.clearImage();
        self.statics.selectImage();
        self.statics.renderImage();
        await self.statics.renderWorkflow("changeIndex");
        selectNode(self);
      }, 256);
    }

    // fix widget size
    setTimeout(() => {
      this.setSize(this.size);
      this.setDirtyCanvas(true, true);
    }, 128);
  } catch(err) {
    console.error(err);
  }
}

// images store when preview node out of screen
function fixPreviewImages({ detail }) {
  // Filter the nodes that have the preview element.
  if (!detail?.output?.images) {
    return;
  }
  
  const imagePaths = detail.output.images.map(e => parseObjectURL(e).filePath);
  const node = app.graph._nodes?.find(e => e.id == detail.node);
  if (node) {
    node.imagePaths = imagePaths;
  }
}

async function executedHandler({ detail }) {
  // detail => String: NodeId
  if (detail) {
    return;
  }

  // detail => null: End of generation
  for (const node of app.graph._nodes) {
    if (node.type === NODE_TYPE) {
      const countImages = node.statics.loadedImages.length;
      const prevIndex = node.statics.getIndex();
      node.statics.updateIndex();
      const currIndex = node.statics.getIndex();
      node.statics.clearWorkflow();
      if (prevIndex !== currIndex && countImages > 0) {
        node.statics.clearImage();
        node.statics.selectImage();
        node.statics.renderImage();
      }
      await node.statics.renderWorkflow("executed");
    }
  }
}

async function loadImages(dirPath) {
  const response = await api.fetchApi(`/shinich39/load-image-with-cmd/load_images`, {
    method: "POST",
    headers: { "Content-Type": "application/json", },
    body: JSON.stringify({ path: dirPath }),
  });

  if (response.status !== 200) {
    throw new Error(response.statusText);
  }

  const data = await response.json();

  return data;
}

function getDefaultCommandValue() {
  const nodes = app.graph._nodes
    .filter(e => e && e.comfyClass !== NODE_TYPE && typeof e.properties?.originalId === "undefined")
    .sort((a, b) => a.id - b.id);

  let text = "";
  text += `// You can use javascript code here!\n\n`;
  for (const node of nodes) {
    const nodeId = node.id;
    const nodeTitle = node.title;
    text += `var n${nodeId} = find(${nodeId}); // ${nodeTitle}\n`;
  }
  text += `\n// *** Global variables ***`;
  text += `\n// SAMPLERS => Node[]: All sampler nodes in flow.`;
  text += `\n// SAMPLER => Node: Last sampler node.`;
  text += `\n// DIR_PATH => String: Directory path of loaded image.`;
  text += `\n// INDEX => Number: Index of loaded image.`;
  text += `\n// FILE_PATH => String: Path of loaded image.`;
  text += `\n// FILENAME => String: Filename of loaded image.`;
  text += `\n// WIDTH => Number: Width of loaded image.`;
  text += `\n// HEIGHT => Number: Height of loaded image.`;
  text += `\n// SEED => Number: Generated random seed each command node.`;
  text += `\n// YEAR => Number`;
  text += `\n// MONTH => Number`;
  text += `\n// DAY => Number`;
  text += `\n// HOURS => Number`;
  text += `\n// MINUTES => Number`;
  text += `\n// SECONDS => Number`;
  text += `\n// countImages => Number: Number of images.`;
  text += `\n// countQueues => Number: Number of queues.`;
  text += `\n// countLoops => Number: Number of loops.`;
  text += `\n//\n// *** Global methods ***`;
  text += `\n// stop(): Disable auto queue mode.`;
  text += `\n// setDirPath(dirPath) => Promise: Change dir_path widget value and load images in directory.`;
  text += `\n// setIndex(index) => Promise: Change index widget value and load image.`;
  text += `\n// loadByFilePath(filePath) => Promise: Load image by file path.`;
  text += `\n// loadByNode(Node) => Promise: Load generated image by Save Image node.`;
  text += `\n// find(ID|TITLE|TYPE [, isActual]) => Node`;
  text += `\n// findLast(ID|TITLE|TYPE [, isActual]) => Node`;
  text += `\n// connect(Node, Node, INPUT_NAME|OUTPUT_NAME)`;
  text += `\n// getValues(Node [, isActual]) => Object: Get widget values in node.`;
  text += `\n// setValues(Node, values [, isActual])`;
  text += `\n// getNode(srcNode, dstNode, name, replaceNodes|null) => Node[]: Get nodes or values from image workflow.`;
  return text;
}

// api.addEventListener("promptQueued", () => {});
api.addEventListener("executed", fixPreviewImages);
api.addEventListener("executing", executedHandler);

app.registerExtension({
	name: `shinich39.${NODE_TYPE}`,
  setup() {
    // ...
  },
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    
    function isNodeExists() {
      for (const node of app.graph._nodes) {
        if (node.type === NODE_TYPE) {
          return true;
        }
      }
      return false;
    }

    function getNodes() {
      let nodes = [];
      for (const node of app.graph._nodes) {
        if (node.type === NODE_TYPE) {
          nodes.push(node);
        }
      }
      return nodes;
    }

    async function saveImage(filePath) {
      const response = await api.fetchApi(`/shinich39/load-image-with-cmd/save_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", },
        body: JSON.stringify({ path: filePath }),
      });
    
      if (response.status !== 200) {
        throw new Error(response.statusText);
      }
    
      return true;
    }

    async function sendToInput() {
      if (this.imgs) {
        // If this node has images then we add an open in new tab item
        let img;
        if (this.imageIndex != null) {
          // An image is selected so select that
          img = this.imgs[this.imageIndex];
        } else if (this.overIndex != null) {
          // No image is selected but one is hovered
          img = this.imgs[this.overIndex];
        }
        if (img) {
          const url = new URL(img.src);
          const filePath = getPathFromURL(url);
          await saveImage(filePath);
        }
      }
    }
    
    async function sendToNode(node) {
      if (this.imgs) {
        // If this node has images then we add an open in new tab item
        let img;
        if (this.imageIndex != null) {
          // An image is selected so select that
          img = this.imgs[this.imageIndex];
        } else if (this.overIndex != null) {
          // No image is selected but one is hovered
          img = this.imgs[this.overIndex];
        }
        if (img) {
          const url = new URL(img.src);
          const obj = parseURL(url);
          const filePath = parseObjectURL(obj).filePath;
          await node.statics.loadImageByPath(filePath);
        }
      }
    }    

    // add "Send to input" to preview image menu
		const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
		nodeType.prototype.getExtraMenuOptions = function (_, options) {
			const r = origGetExtraMenuOptions ? origGetExtraMenuOptions.apply(this, arguments) : undefined;
			let optionIndex = options.findIndex((o) => o?.content === "Save Image");
      if (optionIndex > -1) {
        let newOptions = [
          {
            content: "Send to input",
            callback: () => {
              sendToInput.apply(this);
            },
          }, {
            content: "Send to node",
            disabled: !isNodeExists(),
            submenu: {
              options: getNodes().map((node) => {
                return {
                  content: `#${node.id}`,
                  callback: () => {
                    sendToNode.apply(this, [node]);
                  },
                }
              }),
            },
          },

        ];
        
        options.splice(
          optionIndex + 1,
          0,
          ...newOptions
        );
      }
      return r;
		};

	},
  async afterConfigureGraph(missingNodeTypes) {
    for (const node of app.graph._nodes) {
      if (node.comfyClass === NODE_TYPE) {
        if (!node.statics || !node.statics.isInitialized) {
          initLoadImageNode.apply(node);
        }

        node.statics.resetCounter();
        await node.statics.loadImages();
        // node.statics.updateIndex(node.statics.getIndex());
        node.statics.clearWorkflow();
        node.statics.clearImage();
        node.statics.selectImage();
        node.statics.renderImage();
        await node.statics.renderWorkflow("initialize");

        node.statics.DIR_PATH.isCallbackEnabled = true;
        node.statics.INDEX.isCallbackEnabled = true;
        node.statics.COMMAND.isCallbackEnabled = true;

        // bug fix first run after refreshing
        node.statics.DIR_PATH.prevValue = node.statics.DIR_PATH.value; 
        node.statics.FILENAME.prevValue = node.statics.FILENAME.value;
      }
    }
	},
  nodeCreated(node) {
    if (node.comfyClass === NODE_TYPE) {
      if (!node.statics || !node.statics.isInitialized) {
        initLoadImageNode.apply(node);
      }

      // workflow initialized
      if (!app.configuringGraph) {
        ;(async () => {
          node.statics.resetCounter();
          await node.statics.loadImages();
          // node.statics.updateIndex(node.statics.getIndex());
          node.statics.clearWorkflow();
          node.statics.clearImage();
          node.statics.selectImage();
          node.statics.renderImage();
          await node.statics.renderWorkflow("initialize");

          node.statics.DIR_PATH.isCallbackEnabled = true;
          node.statics.INDEX.isCallbackEnabled = true;
          node.statics.COMMAND.isCallbackEnabled = true;
        })();
      }
    }
  },
});