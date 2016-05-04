/*jshint esversion: 6 */

/*
 * @module GridMap
 * @version 1.0.0
 *
 * GridMap is HeatMap by default, but you can do many more weird stuff with it.
 *
 *
 * There are few concepts / strategies involved in the code. Understanding these would make the code and architecture
 * easier to extend and use.
 *
 * In GridMap everything is a component. And any component can be placed anywhere. We currently have the following
 * components. XAxis, YAxis, GridBody and ColorAxis
 *
 * STACK MANAGER:
 * Using componentStackManager, the components are able to easily place themself whereever they want. The stackManager
 * maintains 2 stacks. One is horizontal another one is vertical. Since the components are place around grid itself,
 * the grid is placed in both the stack. So lets say, this is the stack
 *  Y
 * Axis
 *     	----------
 *  1 	|  |  |  |
 *	----------
 *  2   |  |  |	 |
 *	----------		- GridBody
 *  3	|  |  |	 |
 *	----------
 *  4	|  |  |	 |
 *	----------
 *	  a  b  c 		- X Axis
 *
 *	|||||||||||||| 		- color axis
 * The same thing is placed using componentStackManager, here is how it is done
 * Horizontal stack
 *  ------------------
 * | Y Axis | GridBody|
 *  ------------------
 * Vertical Stack
 *  -----------
 * | GridBody  |
 *  -----------
 * | X Axis    |
 *  -----------
 * | ColorAxis |
 *  -----------
 *
 * AXIS MODEL AND HOOKS:
 * The heart of the axes are the models. This model is calculated by creating an array of unique numbers retrieved
 * by the key from the user given data. Lets say the data be like
 * data = [{
 * 		org: 'M&S',
 *		cost: 21000
 * }, {
 *		org: 'JPM',
 *		cost: 25000
 * }, {
 *		org: 'KPG',
 *		cost: 21000
 * }]
 * And the key for one axis be key = 'cost'
 * So when key is operated on the data this function creates a model of [2100, 2500]
 * The advantage of this is it does not assume the data in a particular format. Instead it asks the user how to
 * operate on the data to retrieve the model.
 * Once the model is calculated, user has the provision to update the model by hooks. Lets say the user might want to
 * sort the Y Axis (which is not in HeatMap grammar thats why GridMap :-D). Hooks are functions that gets called when
 * a particular operation is performed.
 *
 * PREDRAWING AND POSTDRAWING HOOKS:
 * Hooks are callback function given in the data itself. It gets invoked in a particluar time when an particulat event
 * happens. Lets say when axis data is ready PREDRAWING hook is called by sending model values one by one. Once the
 * graphics object related to the model are plotted the POSTDRAWING hook is called passing all the elements.
 *
 * DEPENDENCY INVOCATION / INJECTION:
 * The components' drawing and space calculation functions work by taking a angular like controller function. This
 * function if called with a dependencies list and a function at the end, the last function is called with those
 * dependencies. Currently the list of available dependencies which can be invoked
 * {
 *		componentStackManager: manages the layout and placement of components,
 *		axes: {
 *			x: X Axis instance,
 *			y: Y Axis instance
 * 		}
 *		effectiveChartMeasurement: Measurement of the whole chart including all the components,
 *		effectiveBodyMeasurement: Measurement of the grid body only excluding all the components
 *		graphics: {
 *			chart: d3 plot instance of the svg,
 *			gridMain: d3 plot instance grid including all the components but not the svg defs,
 *			chartBody: d3 plot instance grid body by excluding all the components
 *		},
 *		globalTranslate: The final translation for the vertical stacked elements, if any
 * }
 *
 *
 * Currently, this is the one and only module which is required to run GridMap.
 */

(function () {
	var win = window,
		doc = win.document,
		Math = win.Math,
		ceil = Math.ceil,
		floor = Math.floor,
		d3 = win.d3,
		sel = d3.select,
		hasOwnProp = ({}).hasOwnProperty,
		DEF_FN = function () { return arguments[0]; },
		EMPTY_FN = function () { },
		DEF_COLOR = 'rgba(0, 0, 0, 1)',
		TRANSPARENT_FILL = 'rgba(0, 0, 0, 0.0)',
		PERCENT_STR = '%',
		stubs,
		utils,
		gridManager,
		colorAxisManager,
		interactionManager;


	/*
	 * The abstract base class to create axes. This can't be used as a standalone class. All the default and custom
	 * class should have this class in class hierarchy.
	 *
	 * This class solely takes the responsibility to get the data model ready for the axes. Data model is something that
	 * is the only thing required to draw the axes.
	 *
	 * Child class inheriting this class should give definitation of the following methods
	 * undefined allocateComponentSpace(model, measurement, componentStackManager)
	 *
	 * @param options {Object} - User specified configuration in data
	 * @param data {Object} - The complete data to display the chart
	 * @constructor
	 */
	function AxisModel (options, data) {
		var defaultAxisData = stubs.getForAxis(),
			merge = utils.merge;

		this.config = {};

		// Uses two steps merge to get the default data overridden by user data.

		// First, copies the user data in empty object
		merge(options, this.config);
		// Second, copies the data from default stub. Here in this case, if the data property is already present, it is
		// kept unchanged (hence we achieve override of the default data by user data)
		merge(defaultAxisData, this.config);

		// Holds the grid line graphics components. GridLines are horizontal (for Y Axis) and vertical (for X axis)
		// lines that composes the whole grid.
		this.gridLines = [];
		// The key, value of which would be pushed in axis model
		this.dataKey = undefined;
		// Axis name gives context on the axis itself by mentationing what the axis means
		this.axisName = this.config.name.text;

		// Prepares the model from the data
		this.model = this.getNormalizedModel(data);
	}

	AxisModel.prototype.constructor = AxisModel;

	/*
	 * This takes the raw user given data as input and produce the model from the data.
	 * See AXIS MODEL AND HOOKS at top.
	 *
	 * @param data {object} - data entered by the user
	 *
	 * @return {Array} - Array of unique values that consists the model
	 */
	AxisModel.prototype.getNormalizedModel = function (data) {
		var dataset = data.dataset,
			set,
			allData = [],
			allValues = [],
			datasetData,
			setData,
			model,
			config = this.config,
			key = config.key,
			modelUpdateFn = config.model;

		// Gets the key form the data and saves it in instance
		this.dataKey = key;

		// Gets all the data from the user given object across all the dataset and saves it in a array
		for (set of dataset) {
			datasetData = set.data;
			[].push.apply(allData, datasetData);
		}

		// Now that it has all the set data across datasets, extracts the values from this by the key
		for (setData of allData) {
			allValues.push(setData[key]);
		}

		// In order to create the model, unique values are required. Hence it creates a set to get rid of duplicates and
		// creates a array after that.
		model = Array.from((new Set(allValues)));

		// Allows user to update the model (once created) by providing hooks. Lets say, user wants to sort the model,
		// he would be easily able to do this from this approach.
		return (modelUpdateFn && typeof modelUpdateFn === 'function' && modelUpdateFn(model)) || model;
	};

	/*
	 * Retrieves the model, once created.
	 * What is model for axes? See AXIS MODEL AND HOOKS at top.
	 *
	 * @return {Array} - The model for the axis
	 */
	AxisModel.prototype.getModel = function () {
		return this.model;
	};

	/*
	 * Retrieves the key, once model is created.
	 * What is key for axes? See AXIS MODEL AND HOOKS at top.
	 *
	 * @return {String} - The key to create the model for the axis
	 */
	AxisModel.prototype.getDataKey = function () {
		return this.dataKey;
	};

	/*
	 * Does space calculation prior to drawing.
	 * Each component should be able to calculate space before it is drawn. These functions and drawing functions
	 * uses angular like dependency invocation. Since various components might need different chart metrics to calculate
	 * the space, it is upto the component to inject the dependency in itself.
	 * See DEPENDENCY INVOCATION / INJECTION at top for list of all dependencies.
	 *
	 * @param controller {Function} - Helps to inject the required dependencies which are asked
	 */
	AxisModel.prototype.updatePreDrawingSpace = function (controller) {
		var getTextMetrics = utils.getTextMetrics,
			labelStyle = this.config.label.style;

		// Aks for the the dependenies that are needed to calculate the component space.
		// Details of all the dependencies which can be invoked is listed at top.
		controller([
			'effectiveBodyMeasurement',
			'componentStackManager',
			function (measurement, componentStackManager) {
				var model = this.model,
					index = 0,
					length = model.length,
					allDimension = [];

				for (; index < length; index++) {
					// Gets all the model texts which will be plotted.
					allDimension.push(getTextMetrics(model[index], labelStyle));
				}

				// Relegates the call to the child derived class, so that it manages it's own parts
				this.allocateComponentSpace(allDimension, measurement, componentStackManager);
			}.bind(this)
		]);
	};

	/*
	 * X Axis of the chart.
	 *
	 * @param options {Object} - User specified configuration in data
	 * @param data {Object} - The complete data to display the chart
	 * @constructor
	 */
	function XAxisModel () {
		AxisModel.apply(this, arguments);

		// Stacking order that lets componentStackManager know the poition of the component. By default it is placed
		// just after the GridBody, to bottom
		this.stackingOrder = 1;
		this.meta = {};
	}

	XAxisModel.prototype = Object.create(AxisModel.prototype);
	XAxisModel.prototype.constructor = XAxisModel;

	/*
	 * Calculates the componenets space that will be occupied if drawn.
	 *
	 * @param allDimension {Array} - The data model for the axis
	 * @param measurement {Object} - The measurement of GridBody
	 * @param componentStackManager {Object} - Stack Manager to completes the layout
	 */
	XAxisModel.prototype.allocateComponentSpace = function (allDimension, measurement, componentStackManager) {
		var max = Number.NEGATIVE_INFINITY,
			config = this.config,
			meta = this.meta,
			getTextMetrics = utils.getTextMetrics,
			stackingKeys = componentStackManager.keys,
			totalHeight = 0,
			index,
		 	length,
		 	thisDimension,
		 	axisNameMetrics;

		// Find the max height of the texts to be plotted
		for (index = 0, length = allDimension.length; index < length; index++) {
		 	thisDimension = allDimension[index];

		 	if (max < thisDimension.height) {
		 		max = thisDimension.height;
		 	}
		}

		meta.maxLabelHeight = ceil(max);
		// Takes care of the space if margin is suggested by user. Margin is the space between the prev component and
		// the current component. If not given 0 by default.
		totalHeight += (ceil(max) + (config.label.margin || 0));

		if (this.axisName) {
			// If axis name is given, allocates space for axis name as well.
	 		meta.axisNameMetrics = axisNameMetrics = getTextMetrics(this.axisName, config.name.style);
	 		totalHeight += axisNameMetrics.height + (config.name.margin || 0);
		}

		// Reduces the chart body height, so that this axis component can be drawn.
		measurement.height -= meta.height = totalHeight;

		// Let the componentStackManager know about the orientation, position and how much height it is going to take if
		// plotted.
		componentStackManager.placeInStack(stackingKeys.VERTICAL, this.stackingOrder)(this, { height: totalHeight });
	};

	/*
	 * Draws the X Axis. This should draw all the sub component of x axis. Like name, gridlines, labels.
	 * These drawing functions uses angular like dependency invocation. Since various components might need different
	 * chart metrics to calculate the space, it is upto the component to inject the dependency in itself.
	 * See DEPENDENCY INVOCATION / INJECTION at top for list of all dependencies.
	 *
	 * @param controller {Function} - Helps to inject the required dependencies which are asked
	 */
	XAxisModel.prototype.draw = function (controller) {
		controller([
			'graphics',
			'effectiveBodyMeasurement',
			'componentStackManager',
			'globalTranslate',
			function (graphics, effBodyMes, componentStackManager, globalTranslate) {
				var effBodyWidth = effBodyMes.width,
					effBodyHeight = effBodyMes.height,
					gridMain = graphics.gridMain,
					chartBody = graphics.chartBody,
					stackingKeys = componentStackManager.keys,
					stackedItem,
					axisGroup,
					drawResult;

				// Get the item from the stackManager. stackManager determines the position from the stacking order.
				stackedItem = componentStackManager.getStackItemByInstance(stackingKeys.VERTICAL, this);

				// Draws the grid lines inside the grid body
				this.drawGridLines(chartBody, {
					width: effBodyWidth,
					height: effBodyHeight
				});

				// Creates a group where the name and labels will be attached
				axisGroup = gridMain.append('g');

				// Draws the labels and gets the space taken by the labels
				drawResult = this.drawAxisLabels(axisGroup, {
					width: effBodyWidth,
					height: effBodyHeight,
					y: 0
				});

				// Draws the name right after the labels are drawn
				drawResult = this.drawAxisName(axisGroup, {
					width: effBodyWidth,
					height: effBodyHeight,
					y: drawResult.height
				});

				// Apply translation to the component, if any global translation happened in the body.
				// If in a horizontal stacking if any component is placed before the GridBody, its more likely that a
				// global transalation will happen. This transalation is calculated when all the components left to the
				// GridBody manages their own space.
				axisGroup.attr({
					'class': 'axis x',
					'transform': 'translate(' + (0 + (globalTranslate.x || 0)) +',' +
						(stackedItem.pos + (globalTranslate.y || 0)) + ')'
				});

			}.bind(this)
		]);
	};

	/*
	 * Draws gridlines on the chart body. X axis draws the vertical grid lines on the body. Post plotting the lines,
	 * calls hook function by passing all the graphics element.
	 *
	 * @param targetGroup {SVGGraphicsElement} - Group element under which the grid lines will be drawn
	 * @param measurement {Object} - Measurement of the body of the Grid
	 */
	XAxisModel.prototype.drawGridLines = function (targetGroup, measurement) {
		var model = this.model,
			modelSize = model.length,
			conf = this.config,
			blockSize = measurement.width / modelSize;

		// Creates a seperate group where the gridlines will be attached
		this.gridLines = targetGroup.append('g').attr({
			class : 'grid v-grid'
		}).selectAll('line').data(model).enter().append('g').attr({
			transform : function (d, i) { return 'translate(' + (i * blockSize) + ', 0)'; }
		}).append('line').attr({
			y1: 0,
			y2: measurement.height
		}).style(conf.gridLine.style);

		conf.gridLine.postDrawingHook.call(targetGroup, this.gridLines);

		return this.gridLines;
	};

	/*
	 * Draws labels just below the chart body. This labels are essentially the model of the X axis. What ever is present
	 * in model will be drawn as label. Once the labels are plotted the postDrawingHook for the same is called.
	 *
	 * @param targetGroup {SVGGraphicsElement} - Group element under which the labels will be drawn
	 * @param measurement {Object} - Measurement of the body of the Grid
	 * @return {Object} - A simple key value pair that gives back the height taken and any offsetTranslation which is
	 * suggested
	 */
	XAxisModel.prototype.drawAxisLabels = function (targetGroup, measurement) {
		var model = this.model,
			config = this.config,
			meta = this.meta,
			modelSize = model.length,
			blockSize = measurement.width / modelSize,
			labelConfig = config.label,
			margin = labelConfig.margin || 0,
			y = measurement.y,
			preDrawingHook = labelConfig.preDrawingHook,
			postDrawingHook = labelConfig.postDrawingHook,
			labelGroup,
			allText;

		// Creates a separate group where the labels will be drawn
		labelGroup = targetGroup.append('g').attr({
			'class': 'label'
		});

		allText = labelGroup.selectAll('text').data(model).enter().append('text').attr({
			class: 'axis text',
			dx: '-0.25em',
			x : function (d, i) { return (i *  blockSize) + (blockSize / 2); },
			y: y + margin + meta.maxLabelHeight / 2
		}).text(preDrawingHook).style(labelConfig.style);

		// Once all text are plotted in DOM, call the hook callback by passing all the SVGElements
		postDrawingHook(allText);

		return {
			height: meta.maxLabelHeight + margin,
			offsetTranslation: margin
		};
	};

	/*
	 * Draws name just below the labels. Once the name is plotted the postDrawingHook for the same is called.
	 *
	 * @param targetGroup {SVGGraphicsElement} - Group element under which the labels will be drawn
	 * @param measurement {Object} - Measurement of the body of the Grid
	 * @return {Object} - A simple key value pair that gives back the height taken and any offsetTranslation which is
	 * suggested. If not drawn it return 0 as value of the keys.
	 */
	XAxisModel.prototype.drawAxisName = function (targetGroup, measurement) {
		var config = this.config,
			axisName = this.axisName,
			meta = this.meta,
			nameConfig = config.name,
			preDrawingHook = nameConfig.preDrawingHook,
			postDrawingHook = nameConfig.postDrawingHook,
			margin = nameConfig.margin || 0,
			width = measurement.width,
			res = {
				height: 0,
				offsetTranslation: 0
			},
			plotItem;

		// If axis name is present draw it and return the space taken, else return no space taken
		if (axisName) {
			plotItem = targetGroup.append('text').attr({
				x: width / 2,
				y: measurement.y + margin,
			}).text(preDrawingHook(axisName)).style(config.name.style);

			postDrawingHook(plotItem);

			res.height = meta.axisNameMetrics.height + margin;
			res.offsetTranslation = margin;
		}

		return res;
	};


	/*
	 * Y Axis of the chart.
	 *
	 * @param options {Object} - User specified configuration in data
	 * @param data {Object} - The complete data to display the chart
	 * @constructor
	 */
	function YAxisModel () {
		AxisModel.apply(this, arguments);

		// Stacking order that lets componentStackManager know the poition of the component. By default it is placed
		// just before the GridBody, to the left
		this.stackingOrder = 0;
		this.meta = {};
	}

	YAxisModel.prototype = Object.create(XAxisModel.prototype);
	YAxisModel.prototype.constructor = YAxisModel;

	/*
	 * Calculates the componenets space that will be occupied if drawn.
	 *
	 * @param allDimension {Array} - The data model for the axis
	 * @param measurement {Object} - The measurement of GridBody
	 * @param componentStackManager {Object} - Stack Manager to completes the layout
	 */
	YAxisModel.prototype.allocateComponentSpace = function (allDimension, measurement, componentStackManager) {
		var max = Number.NEGATIVE_INFINITY,
			config = this.config,
			meta = this.meta,
			getTextMetrics = utils.getTextMetrics,
			stackingKeys = componentStackManager.keys,
			totalWidth = 0,
			index,
		 	length,
		 	thisDimension,
		 	axisNameMetrics;

		meta.modelSyncDimension = allDimension;

		// Find the max height of the texts to be plotted
		for (index = 0, length = allDimension.length; index < length; index++) {
		 	thisDimension = allDimension[index];

		 	if (max < thisDimension.width) {
		 		max = thisDimension.width;
		 	}
		}

		meta.maxLabelWidth = ceil(max);
		// Takes care of the space if margin is suggested by user. Margin is the space between the prev component and
		// the current component. If not given 0 by default.
		totalWidth += (ceil(max) + (config.label.margin || 0));

		if (this.axisName) {
			// If axis name is given, allocates space for axis name as well.
		 	meta.axisNameMetrics = axisNameMetrics = getTextMetrics(this.axisName, config.name.style);
		 	totalWidth += axisNameMetrics.width + (config.name.margin || 0);
		}

		// Reduces the chart body width, so that this axis component can be drawn.
		measurement.width -= meta.width = totalWidth;

		// Let the componentStackManager know about the orientation, position and how much width it is going to take if
		// plotted.
		componentStackManager.placeInStack(stackingKeys.HORIZONTAL, this.stackingOrder)(this, { width: totalWidth });
	};

	/*
	 * Draws the Y Axis. This should draw all the sub component of y axis. Like name, gridlines, labels.
	 * These drawing functions uses angular like dependency invocation. Since various components might need different
	 * chart metrics to calculate the space, it is upto the component to inject the dependency in itself.
	 * See DEPENDENCY INVOCATION / INJECTION at top for list of all dependencies.
	 *
	 * @param controller {Function} - Helps to inject the required dependencies which are asked
	 */
	YAxisModel.prototype.draw = function (controller) {
		controller([
			'graphics',
			'effectiveBodyMeasurement',
			'componentStackManager',
			function (graphics, effBodyMes, componentStackManager) {
				var effBodyWidth = effBodyMes.width,
					effBodyHeight = effBodyMes.height,
					gridMain = graphics.gridMain,
					chartBody = graphics.chartBody,
					stackingKeys = componentStackManager.keys,
					stackedItem,
					drawResult,
					axisGroup;

				// Get the item from the stackManager. stackManager determines the position from the stacking order.
				stackedItem = componentStackManager.getStackItemByInstance(stackingKeys.HORIZONTAL, this);

				// Draws the grid lines inside the grid body
				this.drawGridLines(chartBody, {
					width: effBodyWidth,
					height: effBodyHeight
				});

				// Creates a group where the name and labels will be attached
				axisGroup = gridMain.append('g');

				// Draws the labels and gets the space taken by the labels
				drawResult = this.drawAxisName(axisGroup, {
					width: effBodyWidth,
					height: effBodyHeight,
					x: 0
				});

				// Draws the name right after the labels are drawn
				drawResult = this.drawAxisLabels(axisGroup, {
					width: effBodyWidth,
					height: effBodyHeight,
					x: drawResult.width
				});

				// Apply translation additional to the component, which is just the component position move in
				// horizontal, in this case, since its the first component it would be 0
				axisGroup.attr({
					'class': 'axis y',
					'transform': 'translate(' + stackedItem.pos +',' + 0 + ')'
				});

			}.bind(this)
		]);
	};

	/*
	 * Draws gridlines on the chart body. Y axis draws the horizontal grid lines on the body. Post plotting the lines,
	 * calls hook function by passing all the graphics element.
	 *
	 * @param targetGroup {SVGGraphicsElement} - Group element under which the grid lines will be drawn
	 * @param measurement {Object} - Measurement of the body of the Grid
	 */
	YAxisModel.prototype.drawGridLines = function (targetGroup, measurement) {
		var model = this.model,
			modelSize = model.length,
			conf = this.config,
			blockSize = measurement.height / modelSize;

		// Creates a seperate group where the gridlines will be attached
		this.gridLines = targetGroup.append('g').attr({
			class : 'grid h-grid'
		}).selectAll('line').data(model).enter().append('g').attr({
			transform : function (d, i) { return 'translate(0, ' + ( (i + 1) * blockSize) + ')'; }
		}).append('line').attr({
			x1: 0,
			x2: measurement.width
		}).style(conf.gridLine.style);

		conf.gridLine.postDrawingHook.call(targetGroup, this.gridLines);

		return this.gridLines;
	};

	/*
	 * Draws labels just left to the chart body. This labels are essentially the model of the Y axis. What ever is
	 * present in model will be drawn as label. Once the labels are plotted the postDrawingHook for the same is called.
	 *
	 * @param targetGroup {SVGGraphicsElement} - Group element under which the labels will be drawn
	 * @param measurement {Object} - Measurement of the body of the Grid
	 * @return {Object} - A simple key value pair that gives back the width taken and any offsetTranslation which is
	 * suggested
	 */
	YAxisModel.prototype.drawAxisLabels = function (targetGroup, measurement) {
		var model = this.model,
			config = this.config,
			meta = this.meta,
			labelConfig = config.label,
			x = measurement.x,
			margin = labelConfig.margin || 0,
			modelSize = model.length,
			blockSize = measurement.height / modelSize,
			preDrawingHook = labelConfig.preDrawingHook,
			postDrawingHook = labelConfig.postDrawingHook,
			modelSyncDimension = meta.modelSyncDimension,
			labelGroup,
			allText;

		// Creates a separate group where the labels will be drawn
		labelGroup = targetGroup.append('g').attr({
			'class': 'label'
		});

		allText = labelGroup.selectAll('text').data(model).enter().append('text').attr({
			class: 'axis text',
			dy: '-0.25em',
			x: x + meta.maxLabelWidth / 2,
			y : function (d, i) { return (i *  blockSize) + (blockSize / 2) + modelSyncDimension[i].height / 2; }
		}).text(preDrawingHook).style(labelConfig.style);

		// Once all text are plotted in DOM, call the hook callback by passing all the SVGElements
		postDrawingHook(allText);

		return {
			width: meta.maxLabelWidth + margin,
			offsetTranslation: margin
		};
	};

	/*
	 * Draws name just left to the labels. Once the name is plotted the postDrawingHook for the same is called.
	 *
	 * @param targetGroup {SVGGraphicsElement} - Group element under which the labels will be drawn
	 * @param measurement {Object} - Measurement of the body of the Grid
	 * @return {Object} - A simple key value pair that gives back the width taken and any offsetTranslation which is
	 * suggested. If not drawn it return 0 as value of the keys.
	 */
	YAxisModel.prototype.drawAxisName = function (targetGroup, measurement) {
		var config = this.config,
			axisName = this.axisName,
			meta = this.meta,
			nameConfig = config.name,
			preDrawingHook = nameConfig.preDrawingHook,
			postDrawingHook = nameConfig.postDrawingHook,
			margin = nameConfig.margin || 0,
			height = measurement.height,
			res = {
				width: 0,
				offsetTranslation: 0
			},
			textWidth,
			plotItem;

		// If axis name is present draw it and return the space taken, else return no space taken
		if (axisName) {
			textWidth = meta.axisNameMetrics.width;

			plotItem = targetGroup.append('text').attr({
				x: measurement.x + textWidth / 2,
				y: height / 2 - meta.axisNameMetrics.height / 2,
			}).text(preDrawingHook(axisName)).style(config.name.style);

			postDrawingHook(plotItem);

			res.width = textWidth + margin;
			res.offsetTranslation = margin;
		}

		return res;
	};

	function Series (name, conf) {
		this.name = name;
		this.conf = conf;
		this.data = {};
		this.cells = [];

		Series.instances.push(this);
	}

	Series.prototype.constructor = Series;
	Series.instances = [];

	Series.getSeriesById = function (id) {
		var instances = Series.instances,
			instance;

		for (instance of instances) {
			if (instance.name === id) {
				return instance;
			}
		}
	};

	Series.prototype.addData = function (i, j, data) {
		var iData = this.data,
			cells = this.cells,
			jData;

		 jData = iData[i] || (iData[i] = {});
		 jData[j] = data;

		 cells.push([i, j]);

		return iData;
	};

	Series.prototype.getSeriesData = function (i, j) {
		var dataArr = this.data,
			data = dataArr[i][j];

		return {
			name: this.name,
			data: data
		};
	};

	/*
	 * Manages the init of a ColorAxis class from the configiuration. This contains the definition of the ColorAxis
	 * classes and initialize the class based on the configuration. Currently the supported conf are
	 * code : {
	 *	key: 'name',
	 *	colors: ['#FFA726', '#9E9E9E', '#607D8B'],
	 *	type: 'series'
	 * }
	 * This instantiates the SeriesColorAxis class. If this color configuration is used the datasets are colored form
	 * the colors key.
	 *
	 * code : {
	 * 	key: 'data.colorValue',
	 * 	values: [0, 100],
	 *	colors: ['#FF6789', '#2196F3'],
	 *	type: 'gradient'
	 * }
	 * This instantiates the GradientColorAxis class. If this color configuration is used the data needs to have a
	 * colorValue key which will take the color from the gradient scale.
	 *
	 * @todo Provision to add custom axis
	 * @todo Add interaction once the axis is clicked
	 */
	colorAxisManager = (function () {
		var axisInstance;

		/*
		 * Abstract implementation of the color axis. This class cannot be used in a standalone manner. Derived class
		 * needs to give implementation of few methods to be able to completely draw the axis.
		 * This takes care of all the main color axis related operations. Color axis is only the rect with fill colors.
		 * Derived class needs to take care of the text drawing.
		 *
		 * @param colorAxisData {Object} - Color configuration from user input
		 * @constructor
		 */
		function ColorAxisBase (colorAxisData) {
			this.colorAxisData = colorAxisData;
			// This is stacked verticallty at the bottom after the grid body and x axis
			this.stackingOrder = 2;
			this.meta = {};
			this.colorRetrieverFn = EMPTY_FN;

			this.stopsConfObj = undefined;
			this.graphics = {
				node: undefined,
				group: undefined,
				trackers: []
			};

			// By default intearction is disabled. If a particular axis has interaction, it should  draw all the 
			// interaction layers and turn this flag to true. If this flag is true, axis calls setUpInteraction function
			// of derived class with interactionManager
			//this.enableInteraction = false;

			// This is key is for the modules which needs ColorAxi to color their component. Lets say the dataset needs
			// to color the rectangle based on a value. The color will be calculated based on this value from a linear
			// scale of colors. If the gradient color range is [0, 100] => ['red', 'green']. then for value 50 the color
			// would be somewhat between red and green. This retrieval of the value is denoted by key.
			this.key = colorAxisData.code.key;
		}

		ColorAxisBase.prototype.constructor = ColorAxisBase;

		/*
		 * Does space calculation prior to drawing.
		 * Each component should be able to calculate space before it is drawn. These functions and drawing functions
		 * uses angular like dependency invocation. Since various components might need different chart metrics to
		 * calculate the space, it is upto the component to inject the dependency in itself.
		 * See DEPENDENCY INVOCATION / INJECTION at top for list of all dependencies.
		 *
		 * This only takes care of the axis space only. It calls getAdditionalSpace of the derived class to get the
		 * further space for placing the labels.
		 *
		 * @param controller {Function} - Helps to inject the required dependencies which are asked
		 */
		ColorAxisBase.prototype.updatePreDrawingSpace = function (controller) {
			controller([
				'effectiveBodyMeasurement',
				'componentStackManager',
				function (measurement, componentStackManager) {
					var colorAxisData = this.colorAxisData,
						margin = colorAxisData.margin || 0,
						totalHeightTaken,
						stackingKeys = componentStackManager.keys,
						additionalSpaceTaken;

					// Asks the for additional space excluding the axis. Text plotted, margin space comes under this
					additionalSpaceTaken = this.getAdditionalSpace();
					// Total height taken is the additional space and the height taken to draw the axis rect.
					totalHeightTaken = colorAxisData.height + additionalSpaceTaken;

					// Reduces the body height by this amount so that color axis can be drawn
					measurement.height -= totalHeightTaken + margin;

					// Let the componentStackManager know about the orientation, position and how much width it is going
					// to take if plotted.
					componentStackManager.placeInStack(stackingKeys.VERTICAL, this.stackingOrder)(this, {
						height: totalHeightTaken
					});

				}.bind(this)
			]);
		};

		/*
		 * This is the most important (probabily the only useful) function for the component which uses colorAxis. This
		 * maps a value to a color.
		 * Each derived class has its own way to map a continuous or discrete domain to a discrete color range. This
		 * function in turn calls the mapping function of the derived class.
		 *
		 * @param: domainValue {Number | Enum} - The value which would be mapped to a color.
		 *
		 * @return {Hex} - The hex color code related to the value.
		 */
		ColorAxisBase.prototype.getColorByDomain = function (domainValue) {
			return this.colorRetrieverFn(domainValue);
		};

		/*
		 * Clipping is used on the axis rectangle to divide it in sections. By default no sections are made on the axis.
		 * Derived class might return the String format of the clip rect if sections are required.
		 *
		 * @return {String | undefined | null} - If sections on axis is required return string format of clip path url
		 *										otherwise null or undefined
		 */
		ColorAxisBase.prototype.getClippedRect = function () {
			// By default no sections are made on the axis
			return null;
		};

		/*
		 * This function is called when the axis needs to be colored. Whatever this function returns is set as the value
		 * of fill attribute of the axis.
		 *
		 * @param svgDefsManager {miniSvgDefsManager} - API to create gradient, clip-path etc.
		 * @param stops {Array} -  Array of svg stop element in a key value pair.
		 *	{ offset: change ratio in percentage, 'stop-color': hex color code, 'stop-opacity': 1 }
		 *
		 * @return {String} - String format of gradient url
		 */
		ColorAxisBase.prototype.getAxisColorByStop = function (svgDefsManager, stops) {
			return svgDefsManager.createLinearGradient('color-axis-grad', true, stops);
		};

		/*
		 * Draws the color axis itself. This only draw the axis rect and calls postAxisPlotDrawing of derived class for
		 * additional drawing viz marker, labels. This drawing function like axes functions uses angular like dependency
		 * invocation. Since various components might need different chart metrics to calculate the space, it is upto
		 * the component to inject the dependency in itself.
		 * See DEPENDENCY INVOCATION / INJECTION at top for list of all dependencies.
		 *
		 * @param controller {Function} - Helps to inject the required dependencies which are asked
		 */
		ColorAxisBase.prototype.draw = function (controller) {
			var colorAxisData = this.colorAxisData,
				defManager = utils.miniSvgDefsManager,
				margin = colorAxisData.margin || 0;

			// Asks the controller for the dependency
			controller([
				'graphics',
				'effectiveBodyMeasurement',
				'componentStackManager',
				'globalTranslate',
				'interactionManager',
				function (graphics, effBodyMes, componentStackManager, globalTranslate, interactionManager) {
					var effBodyWidth = effBodyMes.width,
						gridMain = graphics.gridMain,
						stackingKeys = componentStackManager.keys,
						stackedItem,
						height,
						width,
						measurement,
						axisGroup,
						postPlotRes,
						offsetTranslation;

					// Initializes the svg definitation manager with chart instance
					defManager.init(graphics.chart);

					// Get the item from the stackManager. stackManager determines the position from the stacking order.
					stackedItem = componentStackManager.getStackItemByInstance(stackingKeys.VERTICAL, this);

					// Creates a separete axis group for color axis
					axisGroup = this.graphics.group = gridMain.append('g');

					// Determines the measurement  of the color axis.
					// Width is derived from widthF attribute and width of body
					width = effBodyWidth * colorAxisData.widthF;
					height = colorAxisData.height;
					measurement = {
						height: height,
						width: width,
						x: effBodyWidth / 2 - width / 2,
						y: margin
					};

					// Draws the main rectangular area of the color axis
					this.drawAxis(measurement, axisGroup, defManager, interactionManager);
					// Calls for specifics drawibg like marker label etc
					postPlotRes = this.postAxisPlotDrawing(measurement, this.stopsConfObj);

					// Check if interaction is required, if yes call setUpInteraction function
					// if (this.enableInteraction) {
					// 	this.setUpInteraction(interactionManager);
					// }

					// If any translation is suggested by the postAxisPlotDrawing, apply that
					offsetTranslation = (postPlotRes || {}).offsetTranslation || 0;

					// Apply translation to the component, if any global translation happened in the body.
					// If in a horizontal stacking if any component is placed before the GridBody, its more likely that
					// a global transalation will happen. This transalation is calculated when all the components left
					// to the GridBody manages their own space.
					axisGroup.attr({
						'class': 'axis color',
						'transform': 'translate(' + (offsetTranslation + (globalTranslate.x || 0)) +',' +
							(stackedItem.pos + (globalTranslate.y || 0)) + ')'
					});

				}.bind(this)
			]);
		};

		/*
		 * Draws the main rect of the color axis only.
		 *
		 * @param measurement {Object} - A simple key value pair of measurement of the axis
		 * @param group {SVGGraphicsElement} - Group under which the color axis belongs
		 * @param svgDefsManager {miniSvgDefsManager} - API to create svg defs
		 *
		 * @return {SVGGraphicsElement} - The created svg rect
		 */
		ColorAxisBase.prototype.drawAxis = function (measurement, group, svgDefsManager) {
			var stopsConfObj,
				stops,
				breakRatios,
				axisRect;

			// Gets the stop configuration to draw gradient on axis
			stopsConfObj = this.stopsConfObj = this.getStopsConfiguration();
			stops = stopsConfObj.stopsConf;
			breakRatios = stopsConfObj.breakRatios;

			// Plots rectangle on DOM. Apply clip-path and gradient fill in attributes
			axisRect = this.graphics.node = group.append('rect').attr(measurement).attr({
				'clip-path': this.getClippedRect(svgDefsManager, {
					refRect: measurement,
					ratios: breakRatios
				})
			}).style({
				'fill': this.getAxisColorByStop(svgDefsManager, stops)
			}).style(this.colorAxisData.axis.style);

			return axisRect;
		};

		
		/*
		 * Another specific implementation of the color axis. This type of color axis are preferred when single or
		 * multiple datasets are plotted simultaneously and comparing all the datapoints is the main goal. Typical DS
		 * code : {
		 * 	key: 'data.colorValue',
		 * 	values: [0, 100],
		 * 	colors: ['#FF6789', '#2196F3'],
		 * 	type: 'gradient'
		 * }
		 * The code.key maps to the colorValue key of the set level data obj
		 * The code.values are the array of values associated with array of colors
		 * The code.colors are the array of colors associated with array of values
		 * The code.type is what determines it to be a GradientColorAxis
		 *
		 * @param colorAxisData {Object} - Color configuration from user input
		 * @param data {Object} - The complete chat data
		 */
		function GradientColorAxis (colorAxisData, data) {
			ColorAxisBase.apply(this, arguments);

			// Registers the color retriever function which does the mapping between value and color
			this.colorRetrieverFn = this.getColorByContinuousDomain;

			// Stores the labels to be plotted beneath the axis rect
			this.labelModel = [];

			// Prepares the label model from the data
			this.extractLabelModel(data);
		}

		GradientColorAxis.prototype = Object.create(ColorAxisBase.prototype);
		GradientColorAxis.prototype.constructor = GradientColorAxis;

		/*
		 * Extracts the label model for the labels to be plotted betneath the axis.
		 *
		 * @param data {Object} - The complete chat data
		 */
		GradientColorAxis.prototype.extractLabelModel = function (data) {
			var colorConf = data.axis.color.code;

			this.labelModel = colorConf.values;
		};

		/*
		 * Gets if any additional space is taken for any specific drawing. This is extra space excluding the axis rect.
		 * Like for text, margin between text and rect etc.
		 *
		 * @return {Number} - Space taken. If no extra components are drawn.
		 */
		GradientColorAxis.prototype.getAdditionalSpace = function () {
			var colorAxisData = this.colorAxisData,
				labelModel = this.labelModel,
				getTextMetrics = utils.getTextMetrics,
				labelConf = colorAxisData.label,
				margin = labelConf.margin || 0,
				max = Number.NEGATIVE_INFINITY,
				meta = this.meta,
				index,
				length,
				name,
				textMetrics,
				totalSpaceTaken;

			for (index = 0, length = labelModel.length; index < length; index++) {
				name = labelModel[index];

				textMetrics = getTextMetrics(name, labelConf.style);
				// Gets the maximum height of the labels
				if (max < textMetrics.height) {
					max = textMetrics.height;
				}
			}

			// Space taken is addition of margin and max label height
			totalSpaceTaken = max + margin;
			meta.labelSpaceTaken = totalSpaceTaken;
			return totalSpaceTaken;
		};

		/*
		 * This creates a clip-path in case the axis needs to be divided in sections.
		 * @param svgDefsManager {miniSvgDefsManager} - API to create gradient, clip-path etc.
		 * @param options {Object} - Configuration options required for drawing clip path. This typically contains
		 *			{
		 *				ratios: Ratios of break
		 *				refRect: The reference on which clipping will be applied
		 *			}
		 *
		 * @return {String} clip-path url
		 */
		GradientColorAxis.prototype.getClippedRect = function (svgDefsManager, options) {
			var colorAxisData = this.colorAxisData,
				meta = this.meta,
				axisBreak = colorAxisData.axis.axisBreak,
				breaks = colorAxisData.axis.noOfBreaks,
				ratios = options.ratios,
				max,
				min,
				length,
				sectionSpread,
				breakRatios = [],
				i = 1;

			// Valid value of breaks can be more than 2, if invalid return
			// @todo take care of the negative values. Abs or ignore?
			if (!(breaks && breaks - 1)) { return null; }

			length = ratios.length - 1;
			max = ratios[length];
			min = ratios[0];

			// Gets how much of space (in ratio), a section takes
			sectionSpread = max / breaks;

			while (i !== breaks) {
				// Saves the cumulative breaks in array. Lets say if the breaks = 5, the array would contain
				// [20, 40, 60, 100]
				breakRatios.push((i++) * sectionSpread);
			}

			// Gap between two consecutive sections
			options.tolerance = axisBreak;
			options.ratios = breakRatios.slice(0);

			// Adds the initial and final ratio in the array
			breakRatios.splice(0, 0, min);
			breakRatios.splice(breakRatios.length, 0, max);

			// Saves it as meta information
			meta.breakRatios = breakRatios;

			return svgDefsManager.createClipRect('color-axis-clip', true, options);
		};

		/*
		 * This is used the color the legend axis. It reads the color input and creates svg gradient stops. The
		 * calculation of the stops happen here. This has one array of values and another array of colors. Each value is
		 * associated with a color. Assume the value array be [0, 50, 100] and color array be ['#FF0000', '#00FF00',
		 * '#0000FF']; then in this case for the first half of the axis the color would create a liner gradiend from red
		 * to green and at the later half green to blue.
		 *
		 * @return {Object} - Stops configuration {
		 * 	stopsConf: [{ offset: change ratio in percentage, 'stop-color': hex color code, 'stop-opacity': 1 }],
		 * 	breakRatios: Ratios where the color has just began to change
		 * }
		 */
		GradientColorAxis.prototype.getStopsConfiguration = function () {
			var colorAxisData = this.colorAxisData,
				meta = this.meta,
				code = colorAxisData.code,
				colors = code.colors,
				values = code.values,
				merge = utils.merge,
				stopStub = {
					offset: undefined,
					'stop-color': undefined,
					'stop-opacity': 1
				},
				stops = [],
				breakRatios = [],
				stop,
				ratio,
				index,
				length,
				min,
				max;

			// Gets the extremes
			length = values.length;
			min = values[0];
			max = values[length - 1];
			for (index = 0; index < length; index++) {
				// Brings down any linear scale to 0 - 100
				ratio = (values[index] - min) / (max - min) * 100;
				breakRatios.push(ratio);

				// Creates stops which will be used when creating gradient
				stop = merge(stopStub, {});
				stop.offset = ratio + PERCENT_STR;
				stop['stop-color'] = colors[index];

				stops.push(stop);
			}

			// Saves the interpolating function to be used when get color by values. Its already provided by d3.
			meta.colorFn = d3.scale.linear().domain(code.values).range(code.colors);

			return {
				stopsConf: stops,
				breakRatios: breakRatios,
				values: values
			};
		};

		/*
		 * Color retiever function which does the mapping between value and color
		 *
		 * @param value {String} - value of the point which is to be mapped to color
		 *
		 * @return {Hex} - Color code in hex corrosponding to the name
		 */
		GradientColorAxis.prototype.getColorByContinuousDomain = function (value) {
			return this.meta.colorFn(value);
		};

		/*
		 * @todo instead of sending parameters, it should get the parameters by controller from the parent class.
		 *
		 * This function takes care of drawing the additional components, if any. The space adjustment of all these
		 * should be done in getAdditionalSpace function
		 *
		 * @param: measurement {Object} - The measurement of the legend axis. Since everything else will be aligned
		 *									against this.
		 * @param: stopsConfObj {Object} - The output of getStopsConfiguration
		 */
		GradientColorAxis.prototype.postAxisPlotDrawing = function (measurement, stopsConfObj) {
			var meta = this.meta,
				colorAxisData = this.colorAxisData,
				group = this.graphics.group,
				labelConf = colorAxisData.label,
				margin = labelConf.margin || 0,
				getTextMetrics = utils.getTextMetrics,
				preDrawingHook = labelConf.preDrawingHook,
				textMetrics,
				breakRatios,
				blockLength,
				label,
				min,
				max,
				index,
				ratio,
				values,
				length,
				x;

			// If the breakRatios is available in meta, uses it because it is the modified and recent calculated 
			// breakRatios. Otherwise uses the default one.
			if (!((breakRatios = meta.breakRatios) && meta.breakRatios.length)) {
				breakRatios = stopsConfObj.breakRatios;
			}

			// Get the extremes from the value array
			values = stopsConfObj.values;
			min = values[0];
			max = values[values.length - 1];

			// Draw texts along the axis. These texts are placed at middle of the section division.
			for (index = 0, length = breakRatios.length; index < length; index++) {
				ratio = breakRatios[index];
				blockLength = measurement.width * (ratio - (breakRatios[index - 1] || 0)) / 100;
				x = measurement.x + measurement.width * ratio / 100;

				label = min + ((max - min) * ratio / 100);
				label = preDrawingHook(label);
				textMetrics = getTextMetrics(label, labelConf.style);

				group.append('text').attr({
					x: x,
					y: measurement.y + measurement.height + textMetrics.height / 2 + margin
				}).text(label).style(labelConf.style);
			}
		};

		/*
		 * More specific implementation of the color axis. This type of color axis are preferred when two datasets are
		 * plotted simultaneously and comparing across the datasets is the main goal. Typical data structure
		 * code : {
		 * 	key: 'name',
		 * 	colors: ['#FFA726', '#9E9E9E', '#607D8B'],
		 * 	type: 'series'
		 * }
		 * The code.key maps to the name key of the data obj. Hence every dataset should have unique name.
		 * The code.colors are the array of colors to be on serieses sequantially
		 * The code.type is what determines it to be a SeriesColorAxis
		 *
		 * @param colorAxisData {Object} - Color configuration from user input
		 * @param data {Object} - The complete chat data
		 */
		function SeriesColorAxis () {
			GradientColorAxis.apply(this, arguments);

			// Registers the color retriever function which does the mapping between value and color
			this.colorRetrieverFn = this.getColorBySeriesName;
		}

		SeriesColorAxis.prototype = Object.create(GradientColorAxis.prototype);
		SeriesColorAxis.prototype.constructor = SeriesColorAxis;

		/*
		 * Extracts the label model for the labels to be plotted betneath the axis.
		 *
		 * @param data {Object} - The complete chat data
		 */
		SeriesColorAxis.prototype.extractLabelModel = function (data) {
			var dataset = data.dataset,
				labelModel = this.labelModel,
				index = 0,
				length = dataset.length;

			// Iterates through the datasets to get the name. Once received store it in the model array. The name of the
			// datasets is the model in this cases
			// @todo takes from the keys
			for (; index < length; index++) {
				labelModel.push(dataset[index].name);
			}
		};

		/*
		 * Color retiever function which does the mapping between value and color
		 *
		 * @param name {String} - name of the dataset
		 *
		 * @return {Hex} - Color code in hex corrosponding to the name
		 */
		SeriesColorAxis.prototype.getColorBySeriesName = function (name) {
			var labelModel = this.labelModel,
				colors = this.colorAxisData.code.colors,
				index;

			if ((index = labelModel.indexOf(name)) !== -1) {
				// Get the index of the key from the model. Since the order of the dataset and color array is in the
				// same order, same index is used to return the color
				return colors[index] || DEF_COLOR;
			}

			return DEF_COLOR;
		};

		/*
		 * This is used the color the legend axis. It reads the color input and creates svg gradient stops. The
		 * calculation of the stops happen here. If the axis is of two discrete solid colors that too is acheived by two
		 * gradient colors which have sharp transition. Ex.
		 * 0%   - FF0000
		 * 50%  - FF0000
		 * 50%  - 00FF00
		 * 100% - 00FF00
		 * This would create twosolid colors red and green.
		 *
		 * @return {Object} - Stops configuration {
		 * 	stopsConf: [{ offset: change ratio in percentage, 'stop-color': hex color code, 'stop-opacity': 1 }],
		 * 	breakRatios: Ratios where the color has just began to change
		 * }
		 */
		SeriesColorAxis.prototype.getStopsConfiguration = function () {
			var labelModel = this.labelModel,
				colors = this.colorAxisData.code.colors,
				merge = utils.merge,
				stopStub = {
					offset: undefined,
					'stop-color': undefined,
					'stop-opacity': 1
				},
				stops = [],
				breakRatios = [],
				stop,
				ratio,
				index,
				colorIndex,
				length,
				itr;

			// Iterates the model to generate the stops. Does not account the 0% and 100% as svg acutomatically
			// takes care of this
			for (index = 1, length = labelModel.length; index < length; index++) {
				colorIndex = index - 1;
				// Iterates two times for each labelModel, this is because if there is a change at 50%, the svg expect
				// it like - 50%  - FF0000,  50%  - 00FF00
				itr = 1;
				ratio = floor(index / length * 100);
				breakRatios.push(ratio);

				do {
					// Geberates a new stop for every iteration
					stop = merge(stopStub, {});
					stop.offset = ratio + PERCENT_STR;
					stop['stop-color'] = colors[colorIndex];

					stops.push(stop);
				} while (colorIndex++, itr--);
			}

			return {
				stopsConf: stops,
				breakRatios: breakRatios
			};
		};

		/*
		 * This creates a clip-path in case the axis needs to be divided in sections.
		 * @param svgDefsManager {miniSvgDefsManager} - API to create gradient, clip-path etc.
		 * @param options {Object} - Configuration options required for drawing clip path. This typically contains
		 *		{
		 *			ratios: Ratios of break
		 *			refRect: The reference on which clipping will be applied
		 *		}
		 *
		 * @return {String} clip-path url
		 */
		SeriesColorAxis.prototype.getClippedRect = function (svgDefsManager, options) {
			var colorAxisData = this.colorAxisData,
				axisBreak = colorAxisData.axis.axisBreak;

			// Adds the conf which determines how much space to be given before starting the subsequent section.
			options.tolerance = axisBreak;
			return svgDefsManager.createClipRect('color-axis-clip', true, options);
		};

		SeriesColorAxis.prototype.clickHandler = function (interactionManager) {
			this.clickHandler = function (seriesName) {
				var actionKeys = interactionManager.getActionIDs();

				interactionManager.perform(actionKeys.DELETE_BY_SID, [seriesName]);
			};
		};

		SeriesColorAxis.prototype.drawAxis = function (measurement, group, svgDefsManager, interactionManager) {
			var self = this,
				colorAxisData = self.colorAxisData,
				trackers = self.graphics.trackers,
				labelModel = self.labelModel,
				axisBreak = colorAxisData.axis.axisBreak,
				defaultTracketConf = stubs.getForTracker(),
				SERIES_ID_KEY = 'sId',
				merge = utils.merge,
				conf,
				stopsConfObj,
				breakRatios,
				index,
				length,
				width,
				tracker,
				trackerData;

			self.clickHandler(interactionManager);

			function intermediateClickHandler (data) {
				self.clickHandler.call(self, data[SERIES_ID_KEY]);
			}


			// Gets the tracker configuration
			conf = merge(defaultTracketConf, {});

			GradientColorAxis.prototype.drawAxis.apply(self, arguments);

			stopsConfObj = self.stopsConfObj;
			breakRatios = stopsConfObj.breakRatios.slice(0);

			width = measurement.width;
			breakRatios.unshift(0);
			for (index = 0, length = breakRatios.length; index < length; index++) {
				trackerData = {};

				tracker = group.append('rect').attr({
					x: breakRatios[index] * width / 100 + axisBreak,
					y: measurement.y,
					width: breakRatios[1] * width / 100 - axisBreak,
					height: measurement.height
				}).style(conf.style).style({
					cursor: 'pointer'
				});

				trackerData[SERIES_ID_KEY] = labelModel[index];
				tracker.data([trackerData]);

				tracker.on('click', intermediateClickHandler);			

				trackers[index] = tracker;
			}
		};

		/*
		 * @todo instead of sending parameters, it should get the parameters by controller from the parent class.
		 *
		 * This function takes care of drawing the additional components, if any. The space adjustment of all these
		 * should be done in getAdditionalSpace function
		 *
		 * @param: measurement {Object} - The measurement of the legend axis. Since everything else will be aligned
		 *									against this.
		 * @param: stopsConfObj {Object} - The output of getStopsConfiguration
		 */
		SeriesColorAxis.prototype.postAxisPlotDrawing = function (measurement, stopsConfObj) {
			var colorAxisData = this.colorAxisData,
				labelModel = this.labelModel,
				meta = this.meta,
				group = this.graphics.group,
				breakRatios = stopsConfObj.breakRatios,
				labelConf = colorAxisData.label,
				preDrawingHook = labelConf.preDrawingHook,
				postDrawingHook = labelConf.postDrawingHook,
				axisBreak = colorAxisData.axis.axisBreak,
				getTextMetrics = utils.getTextMetrics,
				margin = labelConf.margin || 0,
				elemArr = [],
				label,
				index,
				length,
				ratio,
				textMetrics,
				x,
				blockLength;

			// Draw markers. Markers are vertical dotted line that separates two section by an additional visual aid.
			for (index = 0, length = breakRatios.length; index < length; index++) {
				// These are placed at every breaks (section) along the axis.
				ratio = breakRatios[index];
				x = measurement.x + measurement.width * ratio / 100 + axisBreak / 2;

				// These are laid out vertically. Markers starts from the beginning of the axis top and vertically
				// grows till the point labels are drawn
				group.append('line').attr({
					x1: x,
					y1: measurement.y,
					x2: x,
					y2: measurement.y + measurement.height + meta.labelSpaceTaken
				}).style(colorAxisData.marker.style);
			}

			// Since n ratio in breakRatios break the axis in (n + 1) sections, it is required to to add the last or
			// first ratio in the array (since it is not included). Hence for n section we would get n element array.
			breakRatios.push(100);
			// Draw texts along the axis. Here the labels are placed in the middle of each sections.
			for (index = 0, length = breakRatios.length; index < length; index++) {
				ratio = breakRatios[index];
				blockLength = measurement.width * (ratio - (breakRatios[index - 1] || 0)) / 100;
				x = measurement.x + measurement.width * ratio / 100;

				label = labelModel[index];
				// Calls the preDrawingHook of the user, before plotting
				label = preDrawingHook(label);
				textMetrics = getTextMetrics(label, labelConf.style);

				// Postion it in the middle of the section
				elemArr[index] = group.append('text').attr({
					x: x - blockLength / 2 + axisBreak / 2,
					y: measurement.y + measurement.height + textMetrics.height / 2 + margin
				}).text(label).style(labelConf.style);
			}

			// Calls the preDrawingHook of the user once plotted
			postDrawingHook(elemArr);

			return {
				offsetTranslation: - axisBreak / 2
			};
		};

		return {
			/*
			 * Initializes the color axis manager by providing access to configuration. It reads the config and 
			 * initializes the required colorAxis (SeriesColorAxis or GradientColorAxis)
			 *
			 * @param colorAxisData {Object} - Color configuration from user input
		 	 * @param data {Object} - The complete chat data
		 	 *
		 	 * @return {ColorAxisBase} - Instance of the required color axis class
			 */
			init: function (colorConfig, chartData) {
				var defaultColorAxisData = stubs.getForColorAxis(),
					merge = utils.merge,
					colorAxisData = {};

				// Gets the user overridden default data
				merge(colorConfig, colorAxisData);
				merge(defaultColorAxisData, colorAxisData);

				// Based on the config, calls the required class's constructor
				switch(colorAxisData.code.type.toLowerCase()) {
					case 'series':
						axisInstance = new SeriesColorAxis(colorAxisData, chartData);
						break;

					case 'gradient':
						axisInstance = new GradientColorAxis(colorAxisData, chartData);
						break;
				}

				return axisInstance;
			}
		};
	})();

	interactionManager = (function () {
		var dmMatrix,
			actionIDs = {},
			actions = {};

		Object.defineProperties(actionIDs, {
			DELETE_BY_SID: { value: 'deleteBySeriesId', enumerable: true, configurable: false, writable: false }	
		});

		actions[actionIDs.DELETE_BY_SID] = function (seriesId) {
			var seriesInstance = Series.getSeriesById(seriesId);
			dmMatrix.unset(seriesInstance);
		};

		return {
			init: function (dataModelMatrix) {
				dmMatrix = dataModelMatrix;	
			},

			getActionIDs: function () {
				return actionIDs;
			},

			perform: function (actionID, actionParamArr) {
				var actionFn = actions[actionID];

				actionFn && actionFn.apply(this, actionParamArr);
			}
		};
	})();

	/*
	 * The heart of data plot drawing. This is a (m x n) matrix where m is the y axis model length and n is the x axis
	 * model length. If a data point is present for any cell, lets say for i = 5 and j = 3 where m = 10 and n = 10 
	 * (10 x 10) matrix is created where in [5, 3] cell the data is set.
	 * Initially when the matrix is prepared, it is set with a falsy value. Later on when the dataset is parsed value is
	 * set for that cell.
	 *
	 * @todo: Incomplete implemention of events. unset is not fired.
	 */
	function DataModelMatrix () {
		// Holds the original (m x n) matrix. Initially filled with falsy value.
		this._matrix = [];
		// Holds the updated cells only.
		this._updateMatrix = {};
		// Lookup model is what that constructs the matrix. What determines m and n is, comes from lookup model.
		this.lookupModel = [];
		// Holds all the callback to be called when updating dataModelMatrix is complete.
		this._elFns = [];
		// Default event maps, if anything is not set.
		this.eventMap = {
			set: EMPTY_FN,
			unset: EMPTY_FN,
			end: EMPTY_FN
		};
	}

	DataModelMatrix.prototype.constructor = DataModelMatrix;

	/*
	 * Adds listener when a particular event happens on dataModelMatrix. 
	 * Currently, the are two events available on which the subscriber can registered to be notified, 
	 * 1. When a cell is set
	 * 2. When a cell is unset
	 *
	 * @param eventMap {Object} - A key value pair that defines the event map
	 *		{
	 *			set: function () { ... }
	 *			unset: function () { ... }
	 * 		}
	 */
	DataModelMatrix.prototype.addModelUpdateListener = function (eventMap) {
		var eMap = this.eventMap,
			eSet,
			eUnset;

		eventMap = eventMap || {};
		eSet = eventMap.set;
		eUnset = eventMap.unset;

		eSet && typeof eSet === 'function' && (eMap.set = eSet);
		eUnset && typeof eUnset === 'function' && (eMap.unset = eUnset);
	};

	/*
	 * Adds listener when model preparation completes 
	 *
	 * @param fn {Function} - Function to be registered
	 * @param context {Object} - Context to be set when fn is called
	 *
	 * @todo make it a part of addModelUpdateListener?
	 */
	DataModelMatrix.prototype.onEnd = function (fn, context) {
		var updateM = this._updateMatrix,
			fns = this._elFns;

		// Pushes to the callback array
		fns.push([fn, context]);

		// Registers a custom function to the end instead of setting the callback directly directly. This manages the 
		// callback's context and additional param setting
		this.eventMap.end = function () {
			var fn,
				fnIndex,
				fnLength;

			for (fnIndex = 0, fnLength = fns.length; fnIndex < fnLength; fnIndex++) {
				fn = fns[fnIndex];
				// Calls it with custom context and update matrix
				// @todo takes updateM from parameter instead of updateM = this._updateMatrix
				fn[0].call(fn[1], updateM);
			}
		};
	};

	/*
	 * Fires an event i.e. calls the listeners.
	 * Event that can be fired are set, unset, end
	 *
	 * @param eventName {Enum} - Type of event's listener to be fired.
	 */
	DataModelMatrix.prototype.fireEvent = function (eventName) {
		this.eventMap[eventName]();
	};

	/*
	 * Sets or creates in the datamodelmatrix cell.
	 * 2 ways it can be called dataModelMatrix.set(i, []) and dataModelMatrix.set(i, j, [])
	 * If j is not sent, that means another row is getting created and sun sequent calls will have j in params.
	 *
	 * @param i {Integer} - the column index
	 * @param j {Integer} - Optional. the row index.
	 * @param val {Array | Function} - The value to be set. If the value is function, then it will be called sending the
	 *		previous value as parameters
	 */
	DataModelMatrix.prototype.set = function () {
		var matrix = this._matrix,
			eSet = this.eventMap.set,
			updateM = this._updateMatrix,
			i,
			j,
			fn,
			prevVal,
			val;

		i = arguments[0];
		if (arguments.length === 2) {
			// If j is not present, value would be the second argument
			val = arguments[1];
			matrix[i] = val;
		} else if (arguments.length === 3) {
			j = arguments[1];
			fn = arguments[2];

			// Gets the previous value before setting the new value, as this will be sent to the function. Now its upto
			// the function to retain the old and new or discard the old or discard the new
			prevVal = matrix[i][j];
			matrix[i][j] = val = fn(prevVal);

			// Saves it in update matrix. The updateMatrix is actually an associative array (Object) that contains only
			//  the updated cells. Thats why the index is like '12', '21', '33'
			val && (updateM[i.toString() + j] = [i, j, val]);

			// Calls a set listener
			eSet(i, j, val);
		}
	};

	/*
	 * Gets the data from matrix.
	 * 
	 * @return {DataModelMatrix._matrix | Array | DataGraphicsHandler | Integer | Boolean} - 
	 * 		If called like dataModelMatrix.get() returns DataModelMatrix._matrix
	 *		If called like dataModelMatrix.get(i) returns Array. This is essentially the row.
	 *		If called like dataModelMatrix.get(i, j) returns DataGraphicsHandler if set or falsy value
	 */
	DataModelMatrix.prototype.get = function () {
		var matrix = this._matrix,
			arg0,
			arg1;

		if (arguments.length === 0) {
			return matrix;
		}
		else if (arguments.length === 1) {
			arg0 = arguments[0];
			return matrix[arg0];
		} else if (arguments.length >= 2) {
			arg0 = arguments[0];
			arg1 = arguments[1];
			return matrix[arg0][arg1];
		}
	};

	DataModelMatrix.prototype.unset = function (series) {
		var updateM = this._updateMatrix,
			cells = series.cells,
			cell,
			dgHandler,
			i,
			j;

		for (cell of cells) {
			i = cell[0];
			j = cell[1];

			dgHandler = updateM[i.toString() + j][2];
			dgHandler.removeSeries(series);
		}

		this.fireEvent('end');
	};

	/*
	 * Manages the graphics element drawing in relation to the dataset drawing and datamodel matrix. Like where ever
	 * the dataplots are tracker needs to be placed. These all are managed by this.
	 */
	function DataGraphicsHandler () {
		// Saves the series which occupies a cell 
		this.series = [];
		// Saves the graphics element per series index for a cell.
		this.dsGraphics = [];
		// Adds tracker generator function per series index for a cell.
		this.trackerGraphicsFn = [];
		// Adds tracker element per series index for a cell.
		this.trackerGraphics = [];
	}

	DataGraphicsHandler.prototype.constructor = DataGraphicsHandler;

	/*
	 * Adds series to the series list. This in turns conveys the fact that, data from two series are trying to occupy 
	 * one cell in the matrix
	 * 
	 * @param series {Series} - series to be added to the list
	 */
	DataGraphicsHandler.prototype.addSeries = function (series) {
		this.series.push(series);
	};

	DataGraphicsHandler.prototype.removeSeries = function (seriesInstance) {
		var allSeries = this.series,
			seriesIndex,
			index,
			length;
		
		for (index = 0, length = allSeries.length; index < length; index++) {
			if (allSeries[index] === seriesInstance) {
				seriesIndex = index;
				break;
			}
		}

		if (seriesIndex !== undefined) {
			allSeries.splice(seriesIndex, 1);
		}
	};

	/*
	 * Adds dataset graphics elements to be drawn on grid.
	 *
	 * @param index {Integer} - series index. This extracts data, functions from the required ds to plot.
	 * @param autoTrackerParam {Array} - Automatic tracker drawing function. Generally in the form of [i, j, fn]
	 */
	DataGraphicsHandler.prototype.addDSGraphicsElement = function (index, autoTrackerParam) {
		var fn,
			param;

		//this.dsGraphics[index] = element;

		if (!autoTrackerParam) {
			return;
		}

		param = autoTrackerParam.slice(0, autoTrackerParam.length - 1);
		fn = autoTrackerParam[autoTrackerParam.length - 1];

		this.trackerGraphicsFn[index] = fn.apply(this, param);
	};

	/*
	 * Darws a tracker on a cell. This default drawing happens the way dataset is drawn. This one more level of function
	 * is required so that it can save the reference of tracker plot.
	 *
	 * @param fn {Function} - function to be called to draw tracker
	 */
	DataGraphicsHandler.prototype.autoTrackerExecutor = function (fn) {
		var eFns = this.trackerGraphicsFn,
			eFn,
			index,
			length;

		for (index = 0, length = eFns.length; index < length; index++) {
			eFn = eFns[index];
			eFn && (this.trackerGraphics[index] = fn(eFn));
		}
	};

	/*
	 * Draws tracker on top of datasets in the grid. Trackers are for interaction. Drawing tracker means plotting an 
	 * transparent rect on top. This component is initialized only once by calling the constructor. No more method calls
	 * happens from outside through out the life time of the component. It should be internally capable enough to draw
	 * the plots when the data model changes.
	 *
	 * @param controller {Function} - Helps to inject the required dependencies which are asked
	 */
	function TrackerModel (controller) {
		var defaultTracketConf = stubs.getForTracker(),
			merge = utils.merge;

		// Gets the tracker configuration
		this.config = {};
		merge(defaultTracketConf, this.config);

		controller([
			'dataModelMatrix',
			'graphics',
			'effectiveBodyMeasurement',
			'axes',
			function (dataModelMatrix, graphics, effectiveBodyMeasurement, axes) {
				// Prepares the draw function by sending one time set up information
				this.draw(dataModelMatrix, {
					parent: graphics.chartBody,
					xBlockSize: effectiveBodyMeasurement.width / axes.x.getModel().length,
					yBlockSize: effectiveBodyMeasurement.height / axes.y.getModel().length
				});

				// Register the same draw function to be called with the updated matrix when the dataModel preparation
				// is complete.
				dataModelMatrix.onEnd(this.draw, this);
			}.bind(this)
		]);
	}

	TrackerModel.prototype.constructor = TrackerModel;

	/*
	 * Draws tracker on the grid.
	 * This method is first called with one time set up params. It stores these params in closure and override the
	 * definition of draw itself, as a side effect. Now if draw is called with the updateMatrix it draws it on the grid.
	 *
	 * @param: options {Object} - One time set up parameters
	 *		{
	 *			parent: Parent group under which the dataset group will be created,
	 *			xBlockSize: For one block in a grid the length of a side towards x axis,
	 *			yBlockSize: For one block in a grid the length of a side towards y axis
	 * 		}
	 */
	TrackerModel.prototype.draw = function (dataModelMatrix, options) {
		var parent = options.parent,
			xBlockSize = options.xBlockSize,
			yBlockSize = options.yBlockSize,
			group;

		// Creates a new group which will be parents of all the color rects (dataset plots).
		group = parent.append('g').attr({
			class: 'tracker'
		});

		/*
		 * Actually draws tracker on grid. This draws the defaukt tracker. The defaul tracker is where ever there is 
		 * dataset rect, there is a tracker. 
		 */
		this.draw = function () {
			var self = this,
				li = dataModelMatrix.get().length,
				lj = dataModelMatrix.get(0).length,
				_trackerFn,
				handler,
				i,
				j;

			_trackerFn = function (trackerFn) {
				var _t = trackerFn(group);
				if (!(_t instanceof Function)) {
					return _t && _t.style(self.config.style);
				}
			};

			group.selectAll('rect').remove();

			for (i = 0; i < li; i++) {
				// Iterates through all the columns
				for (j = 0; j < lj; j++) {
					// For each column, iterates through all the rows and get the handlers for the cell
					handler = dataModelMatrix.get(i, j);

					if (handler) {
						// If data is present, handler is valid hence draws the default tracker covering the whole cell
						handler.autoTrackerExecutor(_trackerFn);

					} else {
						// If no data is present for the cell, still draws an tracker for the empty cell
						group.append('rect').attr({
							y: i *  yBlockSize,
							x: j * xBlockSize,
							height: yBlockSize,
							width: xBlockSize
						}).style(self.config.style);
					}
				}
			}
		};
	};

	/*
	 * Draws the datasets in the grid. Drawing dataset means coloring a grid block.
	 * This component is initialized only once by calling the constructor. No more method calls happens from outside 
	 * through out the life time of the component. It should be internally capable enough to draw the plots when the 
	 * data model changes.
	 *
	 * @param controller {Function} - Helps to inject the required dependencies which are asked
	 */
	function DatasetRenderer (controller) {
		controller([
			'dataModelMatrix',
			'graphics',
			'effectiveBodyMeasurement',
			'axes',
			function (dataModelMatrix, graphics, effectiveBodyMeasurement, axes) {
				// Prepares the draw function by sending one time set up information
				this.draw({
					parent: graphics.chartBody,
					xBlockSize: effectiveBodyMeasurement.width / axes.x.getModel().length,
					yBlockSize: effectiveBodyMeasurement.height / axes.y.getModel().length,
					colorAxis: axes.colorAxis
				});

				// Register the same draw function to be called with the updated matrix when the dataModel preparation
				// is complete.
				dataModelMatrix.onEnd(this.draw, this);
			}.bind(this)
		]);
	}

	DatasetRenderer.prototype.constructor = DatasetRenderer;

	/*
	 * Draws the dataset on the grid.
	 * This method is first called with one time set up params. It stores these params in closure and override the
	 * definition of draw itself, as a side effect. Now if draw is called with the updateMatrix it draws it on the grid.
	 *
	 * @param: options {Object} - One time set up parameters
	 *		{
	 *			parent: Parent group under which the dataset group will be created,
	 *			xBlockSize: For one block in a grid the length of a side towards x axis,
	 *			yBlockSize: For one block in a grid the length of a side towards y axis,
	 *			colorAxis: Color axis to get the color info
	 * 		}
	 */
	DatasetRenderer.prototype.draw = function (options) {
		var parent = options.parent,
			xBlockSize = options.xBlockSize,
			yBlockSize = options.yBlockSize,
			colorAxis = options.colorAxis,
			curry = utils.curry,
			getValueByKeyChain = utils.getValueByKeyChain,
			merge = utils.merge,
			dataGraphicsJoiner = utils.dataGraphicsJoiner,
			group;

		// Creates a new group which will be parents of all the color rects (dataset plots).
		group = parent.append('g').attr({
			class: 'dataset'
		});

		/*
		 * Actually draws the dataset on grid from updateMatrix
		 *
		 * @param: updateMatrix {DataModelMatrix._updateMatrix} - The update matrix based on what the plots are drawn
		 */
		this.draw = function (updateMatrix) {
			var d3Data = [],
				dataSeries,
				lastSeries,
				updateArr,
				index,
				i,
				j,
				seriesIndex,
				dataGraphicsHandler,
				colorDomainVal,
				seriesData,
				preCurriedFn,
				style;

			// preCurriedFn is not our regular function. Its not assured that the function will get all the parameters 
			// at once. Hence this is curried later on.
			preCurriedFn = function (i, j, g) {
				return g.append('rect').attr({
					y: i *  yBlockSize,
					x: j * xBlockSize,
					height: yBlockSize,
					width: xBlockSize
				});
			};

			for (index in updateMatrix) {
				// For each update in the matrix, repeat the process
				
				if (!hasOwnProp.call(updateMatrix, index)) {
					continue;
				}

				// Retrieves the gridIndex (i, j), graphicsHandler and series information from the update matrix
				updateArr = updateMatrix[index];
				i = updateArr[0];
				j = updateArr[1];
				dataSeries = (dataGraphicsHandler = updateArr[2]) && updateArr[2].series || [];

				if (dataSeries.length === 0) {
					// If no series is found for plotting, continue
					continue;
				}

				// If two series have data to be plotted at same position, by default we plot the last series, i.e. 
				// every other series is overlapped with the last series
				seriesIndex = dataSeries.length - 1;
				lastSeries = dataSeries[seriesIndex];

				// Retrieves the set data from the series itself by position
				seriesData = lastSeries.getSeriesData(i, j);
				// Get the value  of the key which will be used to retrieve the color from the color axis
				colorDomainVal = getValueByKeyChain(seriesData, colorAxis.key);

				style = merge(lastSeries.conf.style, {});
				style.fill = colorAxis.getColorByDomain(colorDomainVal);

				d3Data.push({
					x: j * xBlockSize,
					y: i * yBlockSize,
					height: yBlockSize,
					width: xBlockSize,
					style: style
				});

				// Adds this information to dataGraphicsHandler, so that if any component drawing is dependent on this,
				// can be drawn easily, like the default tracker
				dataGraphicsHandler.addDSGraphicsElement(seriesIndex, [i, j, curry(preCurriedFn)]);
			}

			dataGraphicsJoiner(group, {
				append: 'rect'	
			}, d3Data);
		};
	};

	/*
	 * Parses the user given data to GridMap internal data structures.
	 * 
	 * @param rawData {Object} - Users data
	 * @param controller {Function} - Helps to inject the required dependencies which are asked
	 */
	function DatasetParser (rawData, controller) {
		this.rawData = rawData;

		controller([
			'dataModelMatrix',
			'axes',
			function (dataModelMatrix, axes) {
				this.dataModelMatrix = dataModelMatrix;
				this.x = axes.x;
				this.y = axes.y;
			}.bind(this)
		]);
	}

	DatasetParser.prototype.constructor = DatasetParser;

	/*
	 * Initializes the dataModelMatrix with default value. This kinds of relate the grid-view to grid-model. Here the 
	 * view is empty (only grids are present, no set data is drawn) because the model only contains default data. 
	 *
	 * @param rowModel {Array} - The model of x axis
	 * @param colModel {Array} - The model of y axis
	 *
	 * @return {DataModelMatrix} - The updated data model matrix
	 */
	DatasetParser.prototype.getDataModelMatrix = function (rowModel, colModel) {
		var dataModelMatrix = this.dataModelMatrix,
			lookupModel = dataModelMatrix.lookupModel,
			i,
			li,
			j,
			lj;

		// Saves the coloumn model first, this will be iterated with the index i. Sunsequently saves the row model which
		// will be iterated with the index j. Hence the order is important.
		lookupModel.push(colModel);
		lookupModel.push(rowModel);

		// Iterates for the column model
		for (i = 0, li = colModel.length; i < li ; i++) {
			// For every column, creates an array to accommodate the rows (basically creates a 2D array / matrix)
			dataModelMatrix.set(i, []);
			for (j = 0, lj = rowModel.length; j < lj ; j++) {
				// For every columns and every rows now, set a default falsy value.
				dataModelMatrix.set(i, j, function () { return 0; });
			}
		}

		// At the end of this, similar to the view a matrix is created, which is filled wwith 0.
		return dataModelMatrix;
	};

	/*
	 * Parses the dataset entered by user. Parsing means it converts the user input to a DataModelMatrix.
	 * Once parsing is done it fires the end event on dataModelMatrix
	 */
	DatasetParser.prototype.parse = function () {
		var dataset = this.rawData,
			length = dataset.length,
			dataModelMatrix = this.dataModelMatrix,
			yLookup = dataModelMatrix.lookupModel[0],
			xLookup = dataModelMatrix.lookupModel[1],
			x = this.x,
			y = this.y,
			yKey = y.getDataKey(),
			xKey = x.getDataKey(),
			allSeries = [],
			thisDataset,
			data,
			index,
			series,
			set,
			setIndex,
			setLength,
			i,
			j;

		// This callback is called when a value is set in a cell. When its called it gets whatever was set earlier as 
		// parameter.
		function callback (prevObj){
			var obj;

			// If prevObj was created earlier use it other wise create a new instance of DataGraphicsHandler
			obj = prevObj ? prevObj : new DataGraphicsHandler();

			obj.addSeries(series);
			return obj;
		}

		for (index = 0; index < length; index++) {
			// Iterates every series in the dataset
			thisDataset = dataset[index];

			// Creates a new series object and sets the data
			allSeries.push(series = new Series(thisDataset.name, { style : thisDataset.style }));
			data = thisDataset.data;

			for (setIndex = 0, setLength = data.length; setIndex < setLength; setIndex++) {
				// For every series, iterates though the data, and checks the position (index) in the model itself
				set = data[setIndex];
				i = yLookup.indexOf(set[yKey]);
				j = xLookup.indexOf(set[xKey]);

				// Lets series know avout its position as well
				series.addData(i, j, set);
				// Sets in the dataModelMatrix cell by i and j look up
				dataModelMatrix.set(i, j, callback);
			}
		}

		// Once preparation is done, raises the end event
		dataModelMatrix.fireEvent('end');

		return allSeries;
	};


	gridManager = (function () {
		var conf = {},
			components = {},
			componentDef = {},
			diParams = {},
			svg,
			data,
			dataModelMatrix,
			componentStackManager;

		Object.defineProperties(componentDef, {
			X_AXIS_KEY : {
				enumerable : true,
				configurable : false,
				get : function () {
					return {
						key: 'Axes.x',
						defaultClass: XAxisModel
					};
				},
				set: EMPTY_FN
			},

			Y_AXIS_KEY : {
				enumerable : true,
				configurable : false,
				get : function () {
					return {
						key: 'Axes.y',
						defaultClass: YAxisModel
					};
				},
				set: EMPTY_FN
			},

			COLOR_AXIS_KEY : {
				enumerable : true,
				configurable : false,
				get : function () {
					return {
						key: 'Axes.color',
						defaultClass: colorAxisManager
					};
				},
				set: EMPTY_FN
			},

			DS_RENDERER_KEY : {
				enumerable : true,
				configurable : false,
				get : function () {
					return {
						key: 'DSRenderer',
						defaultClass: DatasetRenderer
					};
				},
				set: EMPTY_FN
			},

			DS_PARSER_KEY : {
				enumerable : true,
				configurable : false,
				get : function () {
					return {
						key: 'DSParser',
						defaultClass: DatasetParser
					};
				},
				set: EMPTY_FN
			}
		});

		/*
		 * Register the components class to be used during drawing. Calling this function would save the ref of the 
		 * class in components object. The first invocation happens during draw.
		 *
		 * This function has two modes. 
		 * 1. When it's called with no args it registers all the default classes.
		 * 2. When it's called with 2 args (key and class) it registers the class only.
		 *
		 * @param key {componentDef.key} - The key of the component to be registered
		 * @param className {Constuctor} - Constructor of the class to be registered
		 */
		function registerComponentClasses (key, className) {
			var config;

			if (arguments.length === 0) {
				// If no arguments are passed, default component registration happens
				for (key in componentDef) {
					config = componentDef[key];

					components[config.key] = config.defaultClass;
				}
			}
			else {
			// If arguments are passed, registers the specified component
			components[key] = className;
		}
		}

		function dependencyController (depDesc) {
			var depDescCopy = ([]).slice.call(depDesc, 0),
				args = [],
				prop,
				fn;

			fn = depDescCopy.splice(depDescCopy.length - 1, 1)[0];

			for (prop of depDescCopy) {
				args.push(diParams[prop]);
			}

			return fn.apply(undefined, args);
		}

		diParams.componentStackManager = componentStackManager = (function () {
			var masterStack = { },
				stackKeys = {};

			Object.defineProperties(stackKeys, {
				VERTICAL: {
					enumerable: true,
					configurable: false,
					writable: false,
					value: 'V'
				},
				HORIZONTAL: {
					enumerable: true,
					configurable: false,
					writable: false,
					value: 'H'
				}
			});

			masterStack[stackKeys.VERTICAL] = [];
			masterStack[stackKeys.HORIZONTAL] = [];

			function StackOrder(instance, measurement) {
				this.instance = instance;
				this.measurement = measurement;
				this.pos = 0;
			}

			StackOrder.prototype.constructor = StackOrder;

			return {
				keys: stackKeys,

				placeInStack: function (stackName, i) {
					return function (instance, measurement) {
						var cumulativeSum = 0,
							measurementKey,
							rStack,
							stackItem,
							index,
							length;

						rStack = masterStack[stackName];
						rStack.splice(i, 0, new StackOrder(instance, measurement));

						measurementKey = stackName === stackKeys.VERTICAL ? 'height' : 'width';

						for (index = 0, length = rStack.length; index < length; index++) {
							stackItem = rStack[index];
							stackItem.pos = index ? cumulativeSum : 0;
							cumulativeSum += stackItem.measurement[measurementKey];
						}
					};
				},

				getStackItemByIndex: function (stackName, index) {
					var rStack = masterStack[stackName];

					return rStack[index];
				},

				getStackItemByInstance: function (stackName, instance) {
					var rStack = masterStack[stackName],
						index = 0,
						length = rStack.length,
						stackItem;

					for (; index < length; index++) {
						if ((stackItem = rStack[index]).instance === instance) {
							return stackItem;
						}
					}
				},

				getAdjascentElements: function (stackName, index) {
					var rStack = masterStack[stackName];

					return [rStack[index - 1], rStack[index + 1]];
				}
			};
		})();

		return {
			init: function (svgDOMElement, config, chartData) {
				var defaultData = stubs.getForChartBody(),
					merge = utils.merge;

				// Saves the reference of the root SVG tag and the data entered by user.
				svg = svgDOMElement;
				data = 	chartData;

				// Overrides default data with user data
				merge(config, conf);
				merge(defaultData, conf);

				// Empty stubs for dependency parameters which can be invoked using controller
				diParams.axes = {};
				diParams.effectiveChartMeasurement = {};

				// Creates a new instance of dataModelMatrix per chart instance
				diParams.dataModelMatrix = dataModelMatrix = new DataModelMatrix();

				// Registers the defacult component classes
				registerComponentClasses();
			},

			registerComponents: function (key, className) {
				if (key && className) {
					registerComponentClasses(key, className);
				}
			},

			getKeys: function () {
				return componentDef;
			},

			draw: function (measurement) {
				var width = measurement.width,
					height = measurement.height,
					margin = measurement.margin,
					chart = svg,
					X = components[componentDef.X_AXIS_KEY.key],
					Y = components[componentDef.Y_AXIS_KEY.key],
					DatasetRenderer = components[componentDef.DS_RENDERER_KEY.key],
					colorAxisManager = components[componentDef.COLOR_AXIS_KEY.key],
					stackingKeys = componentStackManager.keys,
					merge = utils.merge,
					translate = {},
					effChartMes,
					chartBody,
					x,
					y,
					colorAxis,
					boundingRect,
					dsParser,
					gridMain,
					bodyMetrics,
					stackedItem,
					axes;

				diParams.interactionManager = interactionManager;
				interactionManager.init(diParams.dataModelMatrix);

				axes = diParams.axes;
				axes.x = x = new X(data.axis.x, data);
				axes.y = y = new Y(data.axis.y, data);
				axes.colorAxis = colorAxis = colorAxisManager.init(data.axis.color, data);

				effChartMes = diParams.effectiveChartMeasurement;
				effChartMes.width = width - margin.left - margin.right;
				effChartMes.height = height - margin.top - margin.bottom;

				bodyMetrics = diParams.effectiveBodyMeasurement = merge(effChartMes, {});

				gridMain = chart.append('g').attr({
					transform : 'translate(' + margin.left + ',' + margin.top + ')',
					class: 'grid-main'
				});

				chartBody = gridMain.append('g').attr({
					'class' : 'grid-body'
				});

				diParams.graphics = {
					chart: chart,
					gridMain: gridMain,
					chartBody: chartBody
				};

				componentStackManager.placeInStack(stackingKeys.VERTICAL, 0)(chartBody, bodyMetrics);
				componentStackManager.placeInStack(stackingKeys.HORIZONTAL, 0)(chartBody, bodyMetrics);

				x.updatePreDrawingSpace(dependencyController);
				y.updatePreDrawingSpace(dependencyController);
				colorAxis.updatePreDrawingSpace(dependencyController);

				boundingRect = chartBody.append('rect').attr({
					height: bodyMetrics.height,
					width: bodyMetrics.width
				}).style(conf.style);

				stackedItem = componentStackManager.getStackItemByInstance(stackingKeys.HORIZONTAL, chartBody);
				translate.x = stackedItem.pos;
				stackedItem = componentStackManager.getStackItemByInstance(stackingKeys.VERTICAL, chartBody);
				translate.y = stackedItem.pos;

				diParams.globalTranslate = translate;

				chartBody.attr({
					transform: 'translate(' + translate.x + ',' + translate.y + ')'
				});

				// Initializes a dataset parser with the given user data
				// @todo Provision for user override
				dsParser = new DatasetParser(data.dataset, dependencyController);
				// Prepares the dataModelMatrix from the x and y axis model. This fills the matrix with a default value.
				// @todo change the name of the function. More like prepareDataModelMatrix
				dataModelMatrix = dsParser.getDataModelMatrix(x.getModel(), y.getModel());

				x.draw(dependencyController);
				y.draw(dependencyController);
				colorAxis.draw(dependencyController);

				// Creates a new DatasetRenderer and TrackerModel. This two component should do the related drawing
				// when model is changed
				new DatasetRenderer (dependencyController);
				new TrackerModel(dependencyController);

				dsParser.parse();
			}
		};
	})();

	function GridMap (config, chartData) {
		var _c,
			chartConf,
			instanceAPI = this,
			merge = utils.merge;

		if (arguments.length > 1) {
			_c = config;
		} else {
			_c = {};
		}

		chartConf = this.config = merge(_c, {});
		merge(stubs.getForGridMap(), chartConf);
		chartConf.parentContainer = utils.getContainer(chartConf.parentContainer);

		instanceAPI.chartData = chartData;

		instanceAPI.svg = undefined;
		instanceAPI.extModules = {};

		return instanceAPI;
	}

	GridMap.prototype.constructor = GridMap;

	GridMap.prototype.getAPIBase = function () {
		// return {
		// 	AxisModel: [AxisModel, Chart.AXIS_KEY],
		// 	DatasetRenderer: [DatasetRenderer, Chart.DS_RENDERER_KEY]
		// }
	};

	GridMap.prototype.registerComponentClass = function (registrationKey, param) {
		this.extModules[registrationKey] = param;
	};

	GridMap.prototype.render = function () {
		var instanceAPI = this,
			config = instanceAPI.config,
			parentContainer = config.parentContainer,
			data = instanceAPI.chartData,
			//extModules = instanceAPI.extModules,
			//moduleKey,
			//extModule,
			//chart,
			svg;

		instanceAPI.svg = svg = parentContainer.append('svg').attr({
			height: config.height,
			width: config.width
		});

		gridManager.init(svg, data.chart, data);
		gridManager.draw(config);
		// chart = new Chart (svg, data.chart, data);

		// for (moduleKey in extModules) {
		// 	extModule = extModules[moduleKey];
		// 	chart['register' + moduleKey].apply(chart, extModule);
		// }

		// chart.draw(config);
	};

	stubs = (function () {

		function getForGridMap () {
			return {
				parentContainer: doc,
				height: 600,
				width: 850,
				margin: { top: 10, right: 10, bottom: 10, left: 10 }
			};
		}

		function getForAxis () {
			return {
				label: {
					margin: 3,
					preDrawingHook: DEF_FN,
					postDrawingHook : DEF_FN,
					style: {
						'text-anchor': 'middle',
						'font-family': 'serif',
						'font-size': '10px'
					}
				},
				name: {
					margin: 5,
					preDrawingHook: DEF_FN,
					postDrawingHook : DEF_FN,
					style : {
						'text-anchor': 'middle',
						'font-weight' : 'bold',
						'font-family': 'sans-serif',
						'font-size': '11px'
					}
				},
				gridLine: {
					postDrawingHook : DEF_FN,
					style : {
						stroke: 'rgba(235, 235, 235, 1)'
					}
				},

				model: DEF_FN
			};
		}

		function getForColorAxis () {
			return {
				widthF: 0.5,
				height: 15,
				margin: 5,
				axis: {
					axisBreak: 6,
					style: {

					}
				},
				marker: {
					showMarker: 1,
					style: {
						stroke: 'rgb(151, 151, 151)',
						'stroke-dasharray': '3 1',
						'stroke-width': 0.5
					}
				},
				label: {
					margin: 4,
					preDrawingHook: DEF_FN,
					postDrawingHook : DEF_FN,
					style: {
						'text-anchor': 'middle',
						'font-size': '9px',
						stroke: '#9E9E9E',
						'stroke-width': '.1px'
					}
				}
			};
		}

		function getForChartBody() {
			return {
				style: {
					fill : 'rgba(0, 0, 0, 0.03)',
					stroke: 'rgba(235, 235, 235, 1)'
				}
			};
		}

		function getForTracker() {
			return {
				style: {
					fill : TRANSPARENT_FILL
				}
			};
		}

		return {
			getForGridMap : getForGridMap,
			getForAxis : getForAxis,
			getForChartBody : getForChartBody,
			getForTracker : getForTracker,
			getForColorAxis: getForColorAxis
		};
	})();

	utils = (function () {
		var tmCanvas;

		function getCanvas () {
			if (tmCanvas) {
				return tmCanvas;
			}

			return tmCanvas = doc.createElement('canvas');
		}

		function getStyleDescriptor (styleObj) {
			var keys = ['font-weight', 'font-size', 'font-family'],
				descStr = '',
				index = 0,
				length = keys.length,
				key;

			for (; index < length; index++) {
				key = keys[index];

				if (key in styleObj) {
					descStr += styleObj[key] + ' ';
				}
			}

			return descStr;
		}

		function getHeight (styleDes) {
			var heightStr,
				mFactor = 1.2;

			if (typeof styleDes === 'object') {
				heightStr = styleDes['font-size'] || '12px';
			} else {
				heightStr = styleDes;
			}

			return heightStr.match(/(\d+)px/)[1] * mFactor;
		}

		return {
			merge : function (source, sink) {
				var prop;

				(function rec (source, sink) {
					var sourceVal;

					for (prop in source) {
						if (!hasOwnProp.call(source, prop)) {
							continue;
						}

						sourceVal = source[prop];
						if (sink[prop] === undefined) {
							sink[prop] = sourceVal;
						} else if (typeof sourceVal === 'object' && typeof sourceVal !== null) {
							rec(sourceVal, sink[prop]);
						}
					}
				})(source, sink);

				return sink;
			},

			getContainer : function (container) {
				return sel(container);
			},

			curry : function (fn) {
				var n = fn.length,
				    p = [];

				return function tfn () {
					var d,
						_p;

					[].push.apply(p, arguments);
					d = n - p.length;

					if (d <= 0) {
						_p = p.slice(0),
						p.length = 0;
						return fn.apply(this, _p);
					}

					return tfn;
				};
			},

			getTextMetrics: function (text, textStyle) {
				var canvas = getCanvas(),
					context = canvas.getContext('2d'),
					styleDescriptor,
					textMetrics;

				if (typeof textStyle === 'string') {
					styleDescriptor = textStyle;
				} else {
					styleDescriptor = getStyleDescriptor(textStyle);
				}

				context.font = styleDescriptor;
				textMetrics = context.measureText(text);
				textMetrics.height = textMetrics.height || getHeight(textStyle);

				return textMetrics;
			},

			miniSvgDefsManager: (function () {
				var points = {
						x1: '0%',
						y1: '0%',
						x2: '0%',
						y2: '0%',
					},
					STOP_STR = 'stop',
					defaultSpreadMethod = 'pad',
					svg,
					defs;

				return {
					init: function (svgElem) {
						svg = svgElem;

						if (!defs) {
							defs = svg.append('defs');
						}
					},

					createLinearGradient: function (id, isHorizontal, stops) {
						var gradient,
							index,
							length,
							stop;

						if (isHorizontal) {
							points.x2 = '100%';
						} else {
							points.y2 = '100%';
						}

						gradient = defs.append('linearGradient')
							.attr('id', id)
							.attr(points)
							.attr('spreadMethod', defaultSpreadMethod);

						for (index = 0, length = stops.length; index < length; index++) {
							stop = stops[index];
							gradient.append(STOP_STR).attr(stop);
						}

						return 'url(#' + id + ')';
					},

					createClipRect: function (id, isHorizontal, measurement) {
						var merge = utils.merge,
							refRect = measurement.refRect,
							ratios = measurement.ratios.slice(0),
							tolerance = measurement.tolerance,
							clipPath,
							clipRect,
							cRefRect,
							ratio,
							index,
							length;

						clipPath = defs.append('clipPath').attr('id', id);

						cRefRect = merge(refRect, {});

						ratios.push(100);
						for (index = 0, length = ratios.length; index < length; index++) {
							ratio = ratios[index];

							clipRect = merge(cRefRect, {});

							if (isHorizontal) {
								clipRect.x += tolerance;
								clipRect.width = cRefRect.width * (ratio - (ratios[index - 1] || 0)) / 100;
								cRefRect.x += clipRect.width;
								clipRect.width -= tolerance;
							} else {
								clipRect.y += tolerance;
								clipRect.height = cRefRect.height * (ratio - (ratios[index - 1] || 0)) / 100;
								cRefRect.y += clipRect.height + tolerance;
								clipRect.height -= tolerance;
							}

							clipPath.append('rect').attr(clipRect);
						}

						return 'url(#' + id + ')';
					}
				};
			})(),

			getValueByKeyChain: function (obj, keychain) {
				var keys = keychain.split('.'),
					index,
					length,
					_o;

				_o = obj;
				for (index = 0, length = keys.length; index < length; index++) {
					_o = _o[keys[index]];
				}

				return _o;
			},

			dataGraphicsJoiner: function (group, selectors, data) {
				var joinedResult,
					exitSelection,
					enterSelection,
					key;

				function applyProps (d) {
					var elem = d3.select(this);

					for (key in d) { 
						if (key === 'style') {
							elem.style(d[key]);
						} else {
							elem.attr(key, d[key]);
						}
					}
				}

				selectors.selectAll === undefined && (selectors.selectAll = selectors.append);

				joinedResult = group.selectAll(selectors.selectAll).data(data);
				enterSelection = joinedResult.enter().append(selectors.append);
				exitSelection = joinedResult.exit();

				joinedResult
					.each(applyProps)
					.style('opacity', 0)
					.transition()
					.style('opacity', 1);

				exitSelection
					.remove();
			}
		};
	})();

	win.GridMap = GridMap;
})();
