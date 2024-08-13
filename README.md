# comfyui-load-image-with-cmd

Load image and partially workflow with javascript.  

## Features  
- Load image by index.  
- Partially load workflow in image.  
- Quick inpainting.  
- Quick drawing.  

## Nodes  
Add node > image > Load image with CMD

## Usage

### Added menu to Save Image node and Preview Image node  
- Send to input  

Copy selected image to "/ComfyUI/input" directory.  

- Send to node  

Load selected image at the sepecific "Load image with CMD" node.  

### Load image with CMD  
Enter dir_path and index to load image.  
Create a virtual workflow from embedded workflow in image metadata.  
Canvas controls \(while focus on the node\):  
- F5 or Ctrl + r: Reload images.  
- Left, Right: Change index.  
- -, =: Change canvas zoom.  
- Mouse left click: Add mask.  
- Mouse right click: Remove mask.  
- Ctrl + left click: Change brush color to selected pixel.  
- Shift + Mouse left click: Drawing.  
- Shift + Mouse right click: Remove drawing.  
- Mouse wheel scroll: Change brush size.  
- Shift + Mouse wheel scroll: Change brush size.  
- Mouse move while wheel click: Move canvas.  
- Mouse move while press space bar: Move canvas.  
  
The primitive node load nodes and values from embedded workflow in loaded image by javascript.  
Copy and paste to textarea on primitive node and use it after customize.  

- Full code for high resolution fix
```js
var n1 = find(1); // Load image
var n11 = find(11); // VAE Encode
var n12 = find(12); // Load Checkpoint
var n13 = find(13); // KSampler
var n14 = find(14); // VAE Decode
var n15 = find(15); // Save Image
var n21 = find(21); // Upscale Latent

getNode(SAMPLER, n13, "positive", [n12]);
getNode(SAMPLER, n13, "negative", n12);
setValues(n13, { seed: SEED });
setValues(n21, {
  width: WIDTH * 1.5,
  height: HEIGHT * 1.5,
});
```

- Full code for inpaint
```js
var n2 = find(2); // Load image
var n3 = find(3); // VAE Encode
var n4 = find(4); // Load Checkpoint
var n5 = find(5); // Set Latent Noise Mask
var n6 = find(6); // KSampler
var n8 = find(8); // VAE Decode
var n9 = find(9); // InvertMask
var n10 = find(10); // ImageCompositeMasked
var n11 = find(11); // Save Image

getNode(SAMPLER, n6, "positive", n4);
getNode(SAMPLER, n6, "negative", 4);
```

- Load nodes and values from KSampler  
```js
var firstSampler = SAMPLERS[0];
var lastSampler = SAMPLER;
var srcSampler = lastSampler; // Last sampler in virtual workflow
var dstSampler = find(2); // KSampler node in actual workflow
var replaceNodes = [1]; // ID of Load Checkpoint node in actual workflow
getNode(srcSampler, dstSampler, "positive", replaceNodes);
getNode(srcSampler, "KSampler", "negative", replaceNodes);
getNode(srcSampler, 2, "latent_image");
getNode("KSampler", dstSampler, "cfg");
```

- Load values from KSampler  
```js
var srcSampler = SAMPLER;
var dstSampler = find(2); // KSampler

// case 1
var widgetValues = getValues(srcSampler);
setValues(dstSampler, widgetValues); // All values
setValues(dstSampler, { seed: SEED }); // Set random seed

// case 2
getNode(srcSampler, dstSampler, "seed"); // Get Seed from image
getNode(srcSampler, dstSampler, "denoise");
```

- Stop after run 5 (In auto queue mode)  
```js
if (countQueues >= 5) { stop(); }
```

- Stop after run 5 loops (In auto queue mode)  
```js
if (countLoops >= 5) { stop(); }
```

- Load generated image immediately  
```js
var saveNode = find(11); // Save Image
loadByNode(saveNode);
```

- More methods are written in the commnad node.  

## References

- [was-node-suite-comfyui](https://github.com/WASasquatch/was-node-suite-comfyui)
- [comfyui-prompt-reader-node](https://github.com/receyuki/comfyui-prompt-reader-node)
- [notification-sound](https://pixabay.com/sound-effects/duck-quack-112941/)
- [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)
- And default ComfyUI nodes...