// -------------------- 1. Define AOI -------------------- //
var geometry = ee.Geometry.Polygon(
  [[[-88.07501218072676, 35.02445673119349],
    [-88.07501218072676, 33.7552577208551],
    [-85.48223874322676, 33.7552577208551],
    [-85.48223874322676, 35.02445673119349]]], null, false);

var northAlabama = geometry;
Map.centerObject(northAlabama, 9);
Map.addLayer(northAlabama, {color: 'red'}, 'Study Area');

// -------------------- 2. Load Hyperion by Month Range -------------------- //
var loadHyperion = function(startMonth, endMonth) {
  var collection = ee.ImageCollection("EO1/HYPERION")
    .filterBounds(northAlabama)
    .filter(ee.Filter.calendarRange(2015, 2015, 'year'))
    .filter(ee.Filter.calendarRange(startMonth, endMonth, 'month'));

  print('Hyperion Image IDs (' + startMonth + '-' + endMonth + '):', collection.aggregate_array('system:id'));

  var image = collection.median();
  image = image.set('footprint', collection.geometry());
  return image;
};

var images = {
  Corn: loadHyperion(4, 6),         // April–June
  Cotton: loadHyperion(7, 9),       // July–September
  Soybeans: loadHyperion(7, 9),     // July–September
  WinterWheat: loadHyperion(10, 12) // October–December
};

// -------------------- 3. Define Bands, Classes, and Colors -------------------- //
var bandList = ['B021', 'B023', 'B025', 'B027', 'B029', 'B031', 'B033', 'B035', 'B037', 'B039',
                'B041', 'B043', 'B045', 'B047', 'B049'];

var classCodes = {
  Corn: 1,
  Cotton: 2,
  Soybeans: 5,
  WinterWheat: 24
};

var colorMap = {
  Corn: '#FFD700',
  Cotton: '#DC143C',
  Soybeans: '#32CD32',
  WinterWheat: '#8A2BE2'
};

var cdl = ee.ImageCollection("USDA/NASS/CDL")
  .filterDate('2015-01-01', '2015-12-31')
  .first();

// -------------------- 4. Display RGB Layers -------------------- //
Map.addLayer(images.Corn.select(['B021', 'B031', 'B041']), {min: 100, max: 3000}, 'Hyperion RGB (Corn)');
Map.addLayer(images.Cotton.select(['B021', 'B031', 'B041']), {min: 100, max: 3000}, 'Hyperion RGB (Cotton)');
Map.addLayer(images.WinterWheat.select(['B021', 'B031', 'B041']), {min: 100, max: 3000}, 'Hyperion RGB (Wheat)');

// -------------------- 4b. Spectral Signature Visualization -------------------- //
var point = ee.Geometry.Point([-87.24216, 34.41416]); // Example point inside cropland
Map.addLayer(point, {color: 'black'}, 'Sample Point');

var spectrum = images.Corn.select(bandList).reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: point,
  scale: 30
});

print('Spectral Signature at Point:', spectrum);

var chart = ui.Chart.array.values({
  array: ee.Array(bandList.map(function(b) { return spectrum.get(b); })),
  axis: 0,
  xLabels: bandList
}).setChartType('LineChart')
  .setOptions({
    title: 'Spectral Signature (Hyperion)',
    hAxis: {title: 'Bands'},
    vAxis: {title: 'Reflectance'},
    lineWidth: 2,
    pointSize: 4
  });

print(chart);

// -------------------- 5. Classification Function -------------------- //
var classifyCrop = function(cropName) {
  var image = images[cropName];
  var footprint = ee.Geometry(image.get('footprint'));
  var code = classCodes[cropName];

  // Compute Vegetation Indices
  var B031 = image.select('B031');
  var B041 = image.select('B041');
  var B024 = image.select('B024');

  var ndvi = B041.subtract(B031).divide(B041.add(B031)).rename('NDVI');
  var ndwi = B031.subtract(B024).divide(B031.add(B024)).rename('NDWI');

  var bands = image.select(bandList).addBands([ndvi, ndwi]);

  var label = cdl.select([0]).rename('label').clip(footprint);
  var binaryLabel = label.expression("b(0) == target ? 1 : 0", {target: code}).rename('label');
  var trainingStack = bands.addBands(binaryLabel);

  var cropSamples = trainingStack.updateMask(label.eq(code)).sample({
    region: footprint,
    scale: 30,
    numPixels: 5000,
    seed: 42,
    geometries: true
  });

  var nonCropSamples = trainingStack.updateMask(label.eq(0)).sample({
    region: footprint,
    scale: 30,
    numPixels: 2000,
    seed: 43,
    geometries: true
  });

  var nonClassCropSamples = trainingStack.updateMask(label.gt(0).and(label.neq(code))).sample({
    region: footprint,
    scale: 30,
    numPixels: 2000,
    seed: 44,
    geometries: true
  });

  var training = cropSamples.merge(nonCropSamples).merge(nonClassCropSamples);

  // Stratified split
  var positives = training.filter(ee.Filter.eq('label', 1)).randomColumn('rand');
  var negatives = training.filter(ee.Filter.eq('label', 0)).randomColumn('rand');

  var posTrain = positives.filter(ee.Filter.lt('rand', 0.7));
  var posTest = positives.filter(ee.Filter.gte('rand', 0.7));
  var negTrain = negatives.filter(ee.Filter.lt('rand', 0.7));
  var negTest = negatives.filter(ee.Filter.gte('rand', 0.7));

  var trainSplit = posTrain.merge(negTrain);
  var testSplit = posTest.merge(negTest);

  var classifier = ee.Classifier.smileRandomForest(100).train({
    features: trainSplit,
    classProperty: 'label',
    inputProperties: bands.bandNames()
  });

  var validated = testSplit.classify(classifier);
  var matrix = validated.errorMatrix('label', 'classification');
  print(cropName + ' Confusion Matrix:', matrix);
  print(cropName + ' Accuracy:', matrix.accuracy());
  print(cropName + ' Kappa:', matrix.kappa());

  return bands.classify(classifier).clip(footprint).rename(cropName);
};

// -------------------- 6. Run and Combine -------------------- //
var cornMap = classifyCrop('Corn');
var cottonMap = classifyCrop('Cotton');
var soyMap = classifyCrop('Soybeans');
var wheatMap = classifyCrop('WinterWheat');

// Combine with overwrite priority: Wheat > Soybeans > Cotton > Corn
var combined = cornMap.multiply(1)
  .where(cottonMap.eq(1), 2)
  .where(soyMap.eq(1), 3)
  .where(wheatMap.eq(1), 4)
  .clip(northAlabama);  // You may also clip to union of all footprints if desired

var finalPalette = ['gray', '#FFD700', '#DC143C', '#32CD32', '#8A2BE2'];
Map.addLayer(combined.reproject({crs: 'EPSG:4326', scale: 30}),
  {min: 0, max: 4, palette: finalPalette}, 'Final Combined Crop Map');

// -------------------- 7. Add Legend -------------------- //
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});
legend.add(ui.Label('Crop Type Legend', {fontWeight: 'bold'}));
var cropLabels = ['Other (0)', 'Corn (1)', 'Cotton (2)', 'Soybeans (3)', 'Winter Wheat (4)'];
for (var i = 0; i < cropLabels.length; i++) {
  legend.add(ui.Panel([
    ui.Label({style: {backgroundColor: finalPalette[i], padding: '8px', margin: '4px'}}),
    ui.Label(cropLabels[i], {margin: '4px'})
  ], ui.Panel.Layout.Flow('horizontal')));
}
Map.add(legend);

// -------------------- 8. Add CDL Crop Reference -------------------- //
var cdlRemap = cdl.remap([1, 2, 5, 24], [1, 2, 3, 4], 0).clip(northAlabama);
Map.addLayer(cdlRemap, {min: 0, max: 4, palette: finalPalette}, 'CDL Reference Map (2015)');
