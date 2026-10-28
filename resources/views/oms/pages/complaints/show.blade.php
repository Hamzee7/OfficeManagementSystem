@extends('oms.master')
@section('content')
    @php($isAdmin = Auth::user()->designation == "Administrator")
    <div class="col-md-9 col-sm-9 col-md-push-3 col-sm-push-3">
        <div class="well" style="margin:0 auto;">
            @if(Session::has('notice'))
                <div class="alert alert-info"> {{Session::get('notice')}} </div>
            @endif
            @if($errors->any())
                <div class="alert alert-danger">
                    @foreach($errors->all() as $error)
                        <div>{{ $error }}</div>
                    @endforeach
                </div>
            @endif

            <h2>#{{ $complaint->id }} {{ $complaint->title ?: 'Complaint' }}</h2>
            <p>
                <span class="label {{ $complaint->statusClass() }}">{{ $complaint->status }}</span>
                <span class="label {{ $complaint->priorityClass() }}">{{ $complaint->priority }}</span>
                <span class="label label-default">{{ $complaint->category }}</span>
            </p>
            <p class="text-muted">
                Reported by {{ $complaint->user->name }} on {{ $complaint->created_at->format('Y-m-d H:i') }}
                @if($complaint->assignee) &middot; Assigned to {{ $complaint->assignee->name }} @endif
                @if($complaint->resolved_at) &middot; Resolved on {{ $complaint->resolved_at->format('Y-m-d H:i') }} @endif
            </p>
            <div class="well well-sm" style="white-space: pre-wrap;">{{ $complaint->complaint }}</div>

            @if($isAdmin)
                <form method="POST" action="/complaints/{{ $complaint->id }}" class="form-inline">
                    {{ csrf_field() }}
                    <input type="hidden" name="_method" value="PUT">
                    <select name="status" class="form-control">
                        @foreach(\App\Oms\Complaint\Models\Complaint::STATUSES as $status)
                            <option value="{{ $status }}" {{ $complaint->status === $status ? 'selected' : '' }}>{{ $status }}</option>
                        @endforeach
                    </select>
                    <select name="assigned_to" class="form-control">
                        <option value="">Unassigned</option>
                        @foreach($admins as $admin)
                            <option value="{{ $admin->id }}" {{ $complaint->assigned_to == $admin->id ? 'selected' : '' }}>{{ $admin->name }}</option>
                        @endforeach
                    </select>
                    <button class="btn btn-primary">Update</button>
                </form>
                <br>
            @endif

            <h4>Comments</h4>
            @forelse($complaint->comments as $comment)
                <div class="panel panel-default">
                    <div class="panel-heading">
                        <strong>{{ $comment->user->name }}</strong>
                        <small class="text-muted">{{ $comment->created_at->format('Y-m-d H:i') }}</small>
                    </div>
                    <div class="panel-body" style="white-space: pre-wrap;">{{ $comment->body }}</div>
                </div>
            @empty
                <p class="text-muted">No comments yet.</p>
            @endforelse

            <form method="POST" action="/complaints/{{ $complaint->id }}/comments">
                {{ csrf_field() }}
                <div class="form-group">
                    <textarea name="body" rows="3" class="form-control" placeholder="Add a comment..."></textarea>
                </div>
                <button class="btn btn-default">Comment</button>
                <a href="/complaints" class="btn btn-link">Back to list</a>
            </form>

            @if($isAdmin)
                <hr>
                <form method="POST" action="/complaints/{{ $complaint->id }}"
                      onsubmit="return confirm('Delete this complaint?');">
                    {{ csrf_field() }}
                    <input type="hidden" name="_method" value="DELETE">
                    <button class="btn btn-danger">Delete <i class="glyphicon glyphicon-remove"></i></button>
                </form>
            @endif
        </div>
    </div>
    <script>
        document.getElementById('title').innerHTML = "Complaint #{{ $complaint->id }}";
    </script>
@stop
