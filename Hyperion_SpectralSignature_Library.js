
// -------------------- 1. Define AOI -------------------- //
var geometry = ee.Geometry.Polygon(
  [[[-88.07501218072676, 35.02445673119349],
    [-88.07501218072676, 33.7552577208551],
    [-85.48223874322676, 33.7552577208551],
    [-85.48223874322676, 35.02445673119349]]], null, false);

var northAlabama = geometry;
Map.centerObject(northAlabama, 9);
Map.addLayer(northAlabama, {color: 'red'}, 'Study Area');



// -------------------- 8. Add CDL Crop Reference -------------------- //
var cdl = ee.ImageCollection("USDA/NASS/CDL")
  .filterDate('2015-01-01', '2015-12-31')
  .first();
var cdlRemap = cdl.remap([1, 2, 5, 24], [1, 2, 3, 4], 0).clip(northAlabama);
var finalPalette = ['gray', '#FFD700', '#DC143C', '#32CD32', '#8A2BE2'];
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
Map.addLayer(cdlRemap, {min: 0, max: 4, palette: finalPalette}, 'CDL Reference Map (2015)');


// -------------------- 2. Load Hyperion Image -------------------- //
var hyperion = ee.ImageCollection("EO1/HYPERION")
  .filterBounds(northAlabama)
  .filterDate('2015-01-01', '2015-12-31');

print('Available Hyperion Images:', hyperion.aggregate_array('system:id'));

var image = hyperion.first();
print('Selected Image:', image);

Map.addLayer(image.select(['B020', 'B030', 'B040']), {min: 100, max: 3000}, 'Hyperion RGB');

// -------------------- 3. Define Sample Points -------------------- //
var cropPoints = ee.FeatureCollection([
  // ee.Feature(ee.Geometry.Point([-87.25201, 34.45469]), {'label': 'Crop'}),
  // ee.Feature(ee.Geometry.Point([-87.19012, 34.64682]), {'label': 'Crop'}),
  // ee.Feature(ee.Geometry.Point([-87.359095, 33.981355]), {'label': 'Crop'}),
  ee.Feature(ee.Geometry.Point([-87.15551, 34.65857]), {'label': 'Cotton'}),
  ee.Feature(ee.Geometry.Point([-87.13598, 34.65497]), {'label': 'Corn'}),
  ee.Feature(ee.Geometry.Point([-87.13761, 34.65938]), {'label': 'Soybean'}),
  ee.Feature(ee.Geometry.Point([-87.145413, 34.761056]), {'label': 'Winter wheat'}),
  // ee.Feature(ee.Geometry.Point([-87.33152, 33.99849]), {'label': 'Water'}),
  // ee.Feature(ee.Geometry.Point([-87.34374, 34.03431]), {'label': 'Forest'}),
  // ee.Feature(ee.Geometry.Point([-87.01925, 35.19616]), {'label': 'Urban'})
]);

var nonCropPoints = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point([-87.33152, 33.99849]), {'label': 'Water'}),
  ee.Feature(ee.Geometry.Point([-87.34374, 34.03431]), {'label': 'Forest'}),
  ee.Feature(ee.Geometry.Point([-87.01925, 35.19616]), {'label': 'Urban'}),
  ee.Feature(ee.Geometry.Point([-87.25201, 34.45469]), {'label': 'Crop'})
]);



Map.addLayer(cropPoints, {color: 'green'}, 'Crop Points');
Map.addLayer(nonCropPoints, {color: 'blue'}, 'Non-Crop Points');

// -------------------- 4. Extract All Band Names -------------------- //
var bandNames = image.bandNames();
print('All Bands:', bandNames);

// -------------------- 5. Extract and Plot Spectral Signatures -------------------- //
var extractSignature = function(points, label) {
  var chart = ui.Chart.image.regions({
    image: image,
    regions: points,
    scale: 30,
    seriesProperty: 'label'
  }).setChartType('LineChart')
    .setOptions({
      title: 'Spectral Signature - ' + label,
      hAxis: {title: 'Band'},
      vAxis: {title: 'Reflectance'},
      lineWidth: 2,
      pointSize: 4
    });
  print(chart);
};

extractSignature(cropPoints, 'Crop');
extractSignature(nonCropPoints, 'Non-Crop');
