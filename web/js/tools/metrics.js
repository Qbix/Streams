(function (window, Q, $, undefined) {

/**
 * Streams/metrics tool.
 * Renders a metrics for some stream
 * @class Streams/metrics
 * @constructor
 * @param {Object} [options] options to pass
 */
Q.Tool.define("Streams/metrics", function(options) {
	var tool = this;
	var state = this.state;

	if (!state.publisherId) {
		throw new Q.Error("Streams/metrics: publisherId undefined");
	}
	if (!state.streamName) {
		throw new Q.Error("Streams/metrics: streamName undefined");
	}

	// get video/audio duration
	if (state.duration) {
		tool.refresh();
	} else {
		if (state.streamName.startsWith("Streams/video") || state.streamName.startsWith("Streams/audio")) {
			Q.Streams.get(state.publisherId, state.streamName, function (err) {
				if (err) {
					return;
				}

				state.duration = this.getAttribute("duration");
				if (!state.duration) {
					throw new Q.Error("Streams/metrics: duration undefined");
				}

				tool.refresh();
			});
		}
	}
},

{
	publisherId: null,
	streamName: null,
	duration: null
},

{
	refresh: function () {
		var tool = this;
		var $toolElement = $(this.element);
		var state = tool.state;

		Q.req("Streams/metrics", "metrics", function (err, response) {
			if (err) {
				return;
			}

			Q.each(response.slots.metrics, function (index, metrics) {
				Q.Template.render("Streams/metrics/iterative", {index}, function (err, html) {
					if (err) {
						return;
					}

					if (index === 0) {
						$toolElement.empty();
					}

					$toolElement.append(html);
					var $avatar = $(".Streams_metrics_avatar[data-index="+index+"]", $toolElement);
					var $chart = $(".Streams_metrics_chart[data-index="+index+"]", $toolElement);

					$avatar.tool("Users/avatar", {userId: metrics.fields.userId}).activate();

					var dataJSON = JSON.parse(metrics.fields.metrics);
					var results = [];
					for (var i =0; i <= state.duration; i++) {
						results[i] = 0;
						Q.each(dataJSON, function (index, data) {
							if (data[0] <= i && i <= data[1]) {
								results[i] = 1;
							}
						});
					}

					// CanvasJSChart
					var chartOptions = {
						animationEnabled: true,
						title: {
							text: ""
						},
						axisY: {
							title: "",
							suffix: "%"
						},
						axisX: {
							title: "Minutes"
						},
						data: [{
							type: "column",
							color: "#546BC1",
							//yValueFormatString: "#,##0.0#"%"",
							dataPoints: (function () {
								var groupSeconds = 60;
								var res = Array(Math.ceil(state.duration/groupSeconds)).fill(0);
								var i = 0;
								Q.each(results, function (second, viewed) {
									if (second > (i+1)*groupSeconds) {
										i++;
									}

									res[i] += viewed;
								});
								res = res.map(function (x) {
									return Math.round(x/60*100);
								});
								var resObj = [];
								Q.each(res, function (index, percents) {
									resObj.push({label: index, y: percents});
								});
								return resObj;
							})()
						}]
					};
					$chart.CanvasJSChart(chartOptions);
				});
			});
		}, {
			fields: {
				publisherId: state.publisherId,
				streamName: state.streamName
			}
		});
	}
});

Q.Template.set('Streams/metrics/iterative',
`<div class="Streams_metrics_avatar" data-index="{{index}}"></div>
<div class="Streams_metrics_chart" data-index="{{index}}"></div>`,
	{text: ['Streams/content']}
);

})(window, Q, Q.jQuery);