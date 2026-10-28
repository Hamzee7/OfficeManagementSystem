@extends('oms.master')
@section('content')
    @php($isAdmin = Auth::user()->designation == "Administrator")
    <div class="col-md-9 col-sm-9 col-md-push-3 col-sm-push-3">
        <div class="well" style="margin:0 auto;">
            @if(Session::has('notice'))
                <div class="alert alert-info"> {{Session::get('notice')}} </div>
            @endif

            <div class="text-center text-muted">
                <h2>{{ $isAdmin ? 'Complaints' : 'My Complaints' }}</h2>
            </div>

            <div class="row text-center">
                @foreach($stats as $label => $count)
                    <div class="col-xs-4 col-sm-2">
                        <h3>{{ $count }}</h3>
                        <small class="text-muted">{{ $label }}</small>
                    </div>
                @endforeach
            </div>
            <hr>

            <form method="GET" action="/complaints" class="form-inline">
                <input type="text" name="search" class="form-control" placeholder="Search..."
                       value="{{ $filters['search'] ?? '' }}">
                <select name="status" class="form-control">
                    <option value="">All statuses</option>
                    @foreach(\App\Oms\Complaint\Models\Complaint::STATUSES as $status)
                        <option value="{{ $status }}" {{ ($filters['status'] ?? '') === $status ? 'selected' : '' }}>{{ $status }}</option>
                    @endforeach
                </select>
                <select name="priority" class="form-control">
                    <option value="">All priorities</option>
                    @foreach(\App\Oms\Complaint\Models\Complaint::PRIORITIES as $priority)
                        <option value="{{ $priority }}" {{ ($filters['priority'] ?? '') === $priority ? 'selected' : '' }}>{{ $priority }}</option>
                    @endforeach
                </select>
                <select name="category" class="form-control">
                    <option value="">All categories</option>
                    @foreach(\App\Oms\Complaint\Models\Complaint::CATEGORIES as $category)
                        <option value="{{ $category }}" {{ ($filters['category'] ?? '') === $category ? 'selected' : '' }}>{{ $category }}</option>
                    @endforeach
                </select>
                <button class="btn btn-default">Filter</button>
                <a href="/complaints" class="btn btn-link">Reset</a>
                @unless($isAdmin)
                    <a href="/complaints/create" class="btn btn-primary pull-right">
                        <i class="glyphicon glyphicon-plus"></i> New Complaint
                    </a>
                @endunless
            </form>
            <br>

            @if($complaints->count() === 0)
                <h5 class="text-success text-center">No complaints to display</h5>
            @else
                <table class="table table-striped table-responsive">
                    <tr>
                        <th>#</th>
                        @if($isAdmin)<th>Employee</th>@endif
                        <th>Title</th>
                        <th>Category</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Assigned</th>
                        <th>Date</th>
                        @if($isAdmin)<th></th>@endif
                    </tr>
                    @foreach($complaints as $complaint)
                        <tr>
                            <td>{{ $complaint->id }}</td>
                            @if($isAdmin)<td>{{ $complaint->user->name }}</td>@endif
                            <td><a href="/complaints/{{ $complaint->id }}">{{ str_limit($complaint->title ?: $complaint->complaint, 40) }}</a></td>
                            <td>{{ $complaint->category }}</td>
                            <td><span class="label {{ $complaint->priorityClass() }}">{{ $complaint->priority }}</span></td>
                            <td><span class="label {{ $complaint->statusClass() }}">{{ $complaint->status }}</span></td>
                            <td>{{ $complaint->assignee ? $complaint->assignee->name : '-' }}</td>
                            <td>{{ $complaint->created_at->format('Y-m-d') }}</td>
                            @if($isAdmin)
                                <td>
                                    <form method="POST" action="/complaints/{{ $complaint->id }}"
                                          onsubmit="return confirm('Delete this complaint?');">
                                        {{ csrf_field() }}
                                        <input type="hidden" name="_method" value="DELETE">
                                        <button class="btn btn-danger btn-xs">
                                            <i class="glyphicon glyphicon-remove"></i>
                                        </button>
                                    </form>
                                </td>
                            @endif
                        </tr>
                    @endforeach
                </table>
                <div class="text-center">{{ $complaints->links() }}</div>
            @endif
        </div>
    </div>
    <script>
        document.getElementById('title').innerHTML = "Complaints";
    </script>
@stop
