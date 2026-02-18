import numpy as np
import plotly.graph_objects as go

COMPACT_HEIGHT = 125

def nice_ceil(val, base=10):
    """Round up to nearest greater multiple of base."""
    return int(np.ceil(val / base)) * base if val > 0 else base

def create_histogram(
    data: np.ndarray,
    bins: int = 10,
    colormap: str = 'viridis',
    compact: bool = True
) -> go.Figure:

    assert bins >= 1, "bins must be at least 1"

    counts, bins = np.histogram(data.ravel(), bins=bins)
    maxcount = np.max(counts)
    bin_centers = 0.5 * (bins[:-1] + bins[1:])
    widths = bins[1:] - bins[:-1]

    nice_max = nice_ceil(maxcount, base=5) + 1

    fig = go.Figure(
        go.Bar(
            x=bin_centers,
            y=counts,
            width=widths,
            marker=dict(
                color=bin_centers,
                colorscale=colormap,
                showscale=False,
                colorbar=dict(title='Bin value'),
                line=dict(width=0)
            ),
            showlegend=False,
        )
    )
    fig.update_layout(
        yaxis_range=[0, nice_max],
        plot_bgcolor='rgba(0, 0, 0, 0)',
        paper_bgcolor='rgba(0, 0, 0, 0)',
        margin=dict(l=0, r=0, t=5, b=0),
        showlegend=False,
        font=dict(color='white'),
        xaxis=dict(
            showgrid=True, 
            showline=False, 
            gridcolor='rgba(255, 255, 255, 0.25)',
            ticks='',
            tickcolor='rgba(255, 255, 255, 0.25)',
            zeroline=False,
            exponentformat='e',
            showexponent='all',
        ),
        yaxis=dict(
            showgrid=True, 
            showline=False, 
            gridcolor='rgba(255, 255, 255, 0.25)',
            ticks='',
            tickcolor='rgba(255, 255, 255, 0.25)',
            zeroline=False,
            exponentformat="SI",
            showexponent="all",
        ),
    )
    if compact:
        fig.update_layout(height=COMPACT_HEIGHT)
    return fig

def create_bar_chart(
    x: np.ndarray,
    y: np.ndarray,
    colormap: str = 'viridis',
    compact: bool = True
) -> go.Figure:
    x = np.asarray(x).ravel()
    y = np.asarray(y).ravel()
    assert len(x) == len(y), "x and y must have the same length"
    assert len(x) >= 1, "x and y must have at least 1 element"
    maxval = np.max(y)
    minval = np.min(y)

    fig = go.Figure(
        go.Bar(
            x=x,
            y=y,
            marker=dict(
                color=y,
                colorscale=colormap,
                showscale=False,
                colorbar=dict(title='Value'),
                line=dict(width=0)
            ),
            showlegend=False,
        )
    )
    fig.update_layout(
        plot_bgcolor='rgba(0, 0, 0, 0)',
        paper_bgcolor='rgba(0, 0, 0, 0)',
        margin=dict(l=0, r=0, t=5, b=0),
        showlegend=False,
        font=dict(color='white'),
        xaxis=dict(
            showgrid=True,
            showline=False,
            gridcolor='rgba(255, 255, 255, 0.25)',
            ticks='',
            tickcolor='rgba(255, 255, 255, 0.25)',
            zeroline=False,
            exponentformat='e',
            showexponent='all',
        ),
        yaxis=dict(
            showgrid=True,
            showline=False,
            gridcolor='rgba(255, 255, 255, 0.25)',
            ticks='',
            tickcolor='rgba(255, 255, 255, 0.25)',
            zeroline=False,
            exponentformat="SI",
            showexponent="all",
        ),
    )
    if compact:
        fig.update_layout(height=COMPACT_HEIGHT)
    return fig

def create_scatter_plot(
    x: np.ndarray,
    y: np.ndarray,
    colormap: str = 'viridis',
    compact: bool = False
) -> go.Figure:
    x = np.asarray(x).ravel()
    y = np.asarray(y).ravel()
    assert len(x) == len(y), "x and y must have the same length"
    assert len(x) >= 1, "x and y must have at least 1 element"

    def nice_ceil(val, base=10):
        """Round up to nearest greater multiple of base."""
        return int(np.ceil(val / base)) * base if val > 0 else base

    def nice_floor(val, base=10):
        """Round down to nearest lesser multiple of base."""
        return int(np.floor(val / base)) * base if val < 0 else 0

    x_min, x_max = np.min(x), np.max(x)
    y_min, y_max = np.min(y), np.max(y)

    fig = go.Figure(
        go.Scatter(
            x=x,
            y=y,
            mode='markers',
            marker=dict(
                size=6,
                color=y,
                colorscale=colormap,
                showscale=False,
                line=dict(width=0)
            ),
            showlegend=False,
        )
    )
    fig.update_layout(
        plot_bgcolor='rgba(0, 0, 0, 0)',
        paper_bgcolor='rgba(0, 0, 0, 0)',
        margin=dict(l=0, r=0, t=5, b=0),
        showlegend=False,
        font=dict(color='white'),
        xaxis=dict(
            showgrid=True,
            showline=False,
            gridcolor='rgba(255, 255, 255, 0.25)',
            ticks='',
            tickcolor='rgba(255, 255, 255, 0.25)',
            zeroline=False,
            exponentformat='e',
            showexponent='all',
        ),
        yaxis=dict(
            showgrid=True,
            showline=False,
            gridcolor='rgba(255, 255, 255, 0.25)',
            ticks='',
            tickcolor='rgba(255, 255, 255, 0.25)',
            zeroline=False,
            exponentformat="SI",
            showexponent="all",
        ),
    )
    if compact:
        fig.update_layout(height=COMPACT_HEIGHT)
    return fig